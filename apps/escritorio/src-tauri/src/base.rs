//! Base local de la app (secciones 9.5 y 10 del plan).
//!
//! * SQLCipher: la base está cifrada en disco con la llave de `llave.rs`.
//! * WAL + synchronous=FULL: lo que se confirmó sobrevive a un apagón.
//! * Al abrir: verificación de integridad; si hay daño, se aparta el archivo dañado y se restaura el
//!   último respaldo (luego la app vuelve a sincronizar con el servidor).
//! * Respaldo diario cifrado; se conservan los últimos 7.
//!
//! TypeScript (`@contafi/local`) solo ve dos operaciones: consultar y ejecutar un lote atómico.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use tauri::{AppHandle, Manager, State};

use crate::llave;

pub struct EstadoBase(pub Mutex<Option<Connection>>);

const ARCHIVO: &str = "contafi.db";
const RESPALDOS_A_CONSERVAR: usize = 7;
const CADA_CUANTO_RESPALDAR: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Serialize)]
pub struct Apertura {
    /// "nueva" | "ok" | "restaurada"
    estado: &'static str,
    ruta: String,
    respaldo: Option<String>,
    mensaje: Option<String>,
}

#[derive(Deserialize)]
pub struct SentenciaSql {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

fn texto<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn ahora_segundos() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn a_valor(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                return Err("Número no representable".into());
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        _ => return Err("Parámetro SQL no soportado: use texto, número o null".into()),
    })
}

/// Los enteros van como número JSON. Los montos (que pueden pasar de 2^53) los lee TypeScript con
/// CAST(x AS TEXT), así que nunca se pierden centavos.
fn a_json(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::from(*x)).collect()),
    }
}

fn comillas(ruta: &Path) -> String {
    ruta.to_string_lossy().replace('\'', "''")
}

/// Ejecuta UNA sentencia y descarta las filas que devuelva (varios PRAGMA devuelven una fila, y
/// `execute`/`execute_batch` pueden rechazarlas según las opciones de rusqlite).
fn ejecutar(con: &Connection, sql: &str) -> rusqlite::Result<()> {
    let mut stmt = con.prepare(sql)?;
    let mut filas = stmt.query([])?;
    while filas.next()?.is_some() {}
    Ok(())
}

/// Abre la base con la llave y la configura. Falla si la llave no corresponde o el archivo está dañado.
fn abrir_conexion(ruta: &Path, llave: &str) -> rusqlite::Result<Connection> {
    let con = Connection::open(ruta)?;
    ejecutar(&con, &format!("PRAGMA key = \"x'{llave}'\""))?;
    // Con una llave errada o un encabezado dañado, la primera lectura falla (SQLITE_NOTADB).
    con.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    ejecutar(&con, "PRAGMA journal_mode = WAL")?;
    ejecutar(&con, "PRAGMA synchronous = FULL")?;
    ejecutar(&con, "PRAGMA foreign_keys = ON")?;
    ejecutar(&con, "PRAGMA busy_timeout = 5000")?;
    Ok(con)
}

fn integra(con: &Connection) -> Result<bool, String> {
    let resultado: String = con.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(texto)?;
    if resultado != "ok" {
        return Ok(false);
    }
    // cipher_integrity_check devuelve una fila por cada página con error de autenticación.
    let mut stmt = con.prepare("PRAGMA cipher_integrity_check").map_err(texto)?;
    let mut filas = stmt.query([]).map_err(texto)?;
    Ok(filas.next().map_err(texto)?.is_none())
}

fn carpeta_respaldos(dir: &Path) -> PathBuf {
    dir.join("respaldos")
}

/// Respaldos existentes, del más reciente al más antiguo.
fn respaldos(dir: &Path) -> Vec<PathBuf> {
    let mut lista: Vec<PathBuf> = std::fs::read_dir(carpeta_respaldos(dir))
        .map(|it| {
            it.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("contafi-") && n.ends_with(".db"))
                })
                .collect()
        })
        .unwrap_or_default();
    lista.sort();
    lista.reverse();
    lista
}

/// Copia cifrada de la base (sqlcipher_export) y limpieza de los respaldos viejos.
fn respaldar_si_toca(con: &Connection, dir: &Path, llave: &str) -> Result<Option<PathBuf>, String> {
    let ultimo = respaldos(dir).into_iter().next();
    let reciente = ultimo
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|edad| edad < CADA_CUANTO_RESPALDAR);
    if reciente {
        return Ok(None);
    }
    let carpeta = carpeta_respaldos(dir);
    std::fs::create_dir_all(&carpeta).map_err(texto)?;
    let destino = carpeta.join(format!("contafi-{:012}.db", ahora_segundos()));
    let version: i64 = con.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(texto)?;
    ejecutar(con, &format!("ATTACH DATABASE '{}' AS respaldo KEY \"x'{llave}'\"", comillas(&destino))).map_err(texto)?;
    let exportado = ejecutar(con, "SELECT sqlcipher_export('respaldo')")
        .and_then(|()| ejecutar(con, &format!("PRAGMA respaldo.user_version = {version}")));
    ejecutar(con, "DETACH DATABASE respaldo").map_err(texto)?;
    exportado.map_err(texto)?;
    for viejo in respaldos(dir).into_iter().skip(RESPALDOS_A_CONSERVAR) {
        let _ = std::fs::remove_file(viejo);
    }
    Ok(Some(destino))
}

/// Aparta un archivo dañado (con su WAL) para análisis, sin borrarlo.
fn apartar_danado(ruta: &Path) {
    let marca = ahora_segundos();
    for sufijo in ["", "-wal", "-shm"] {
        let origen = PathBuf::from(format!("{}{sufijo}", ruta.display()));
        if origen.exists() {
            let _ = std::fs::rename(&origen, format!("{}.danada-{marca}{sufijo}", ruta.display()));
        }
    }
}

#[tauri::command]
pub fn abrir_base(app: AppHandle, estado: State<'_, EstadoBase>) -> Result<Apertura, String> {
    let dir = app.path().app_data_dir().map_err(texto)?;
    std::fs::create_dir_all(&dir).map_err(texto)?;
    let ruta = dir.join(ARCHIVO);
    let llave = llave::obtener_o_crear(&dir)?;
    let existia = ruta.exists();

    let mut resultado = Apertura { estado: if existia { "ok" } else { "nueva" }, ruta: ruta.display().to_string(), respaldo: None, mensaje: None };

    let con = match abrir_conexion(&ruta, &llave) {
        Ok(con) if integra(&con).unwrap_or(false) => con,
        otro => {
            // Dañada (o llave que no corresponde): se cierra (en Windows no se puede mover un archivo
            // abierto), se aparta y se restaura el último respaldo íntegro.
            drop(otro);
            apartar_danado(&ruta);
            resultado.estado = "restaurada";
            let mut restaurada = None;
            for respaldo in respaldos(&dir) {
                if std::fs::copy(&respaldo, &ruta).is_err() {
                    continue;
                }
                match abrir_conexion(&ruta, &llave) {
                    Ok(con) if integra(&con).unwrap_or(false) => {
                        resultado.respaldo = respaldo.file_name().map(|n| n.to_string_lossy().into_owned());
                        restaurada = Some(con);
                        break;
                    }
                    otra => {
                        drop(otra);
                        apartar_danado(&ruta);
                    }
                }
            }
            match restaurada {
                Some(con) => con,
                None => {
                    resultado.mensaje = Some("No había un respaldo válido: se creó una base nueva y se descargará todo desde la nube.".into());
                    abrir_conexion(&ruta, &llave).map_err(texto)?
                }
            }
        }
    };

    if let Err(e) = respaldar_si_toca(&con, &dir, &llave) {
        resultado.mensaje = Some(format!("No se pudo hacer el respaldo diario: {e}"));
    }
    *estado.0.lock().map_err(texto)? = Some(con);
    Ok(resultado)
}

/// Al cerrar sesión se cierra la base y la llave deja de estar en memoria.
#[tauri::command]
pub fn cerrar_base(estado: State<'_, EstadoBase>) -> Result<(), String> {
    *estado.0.lock().map_err(texto)? = None;
    Ok(())
}

#[tauri::command]
pub fn sql_consultar(estado: State<'_, EstadoBase>, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    let guardia = estado.0.lock().map_err(texto)?;
    let con = guardia.as_ref().ok_or("La base local no está abierta.")?;
    let valores = params.iter().map(a_valor).collect::<Result<Vec<_>, _>>()?;
    let mut stmt = con.prepare_cached(&sql).map_err(texto)?;
    let nombres: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut filas = stmt.query(params_from_iter(valores.iter())).map_err(texto)?;
    let mut salida = Vec::new();
    while let Some(fila) = filas.next().map_err(texto)? {
        let mut objeto = Map::with_capacity(nombres.len());
        for (i, nombre) in nombres.iter().enumerate() {
            objeto.insert(nombre.clone(), a_json(fila.get_ref(i).map_err(texto)?));
        }
        salida.push(objeto);
    }
    Ok(salida)
}

/// Ejecuta todas las sentencias en UNA transacción: o se aplican todas o ninguna.
#[tauri::command]
pub fn sql_lote(estado: State<'_, EstadoBase>, sentencias: Vec<SentenciaSql>) -> Result<(), String> {
    let mut guardia = estado.0.lock().map_err(texto)?;
    let con = guardia.as_mut().ok_or("La base local no está abierta.")?;
    let tx = con.transaction_with_behavior(TransactionBehavior::Immediate).map_err(texto)?;
    for s in &sentencias {
        let valores = s.params.iter().map(a_valor).collect::<Result<Vec<_>, _>>()?;
        let mut stmt = tx.prepare_cached(&s.sql).map_err(texto)?;
        // query + recorrer sirve también para sentencias que devuelven filas (algunos PRAGMA).
        let mut filas = stmt.query(params_from_iter(valores.iter())).map_err(texto)?;
        while filas.next().map_err(texto)?.is_some() {}
    }
    tx.commit().map_err(texto)
}
