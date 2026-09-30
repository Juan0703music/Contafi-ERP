//! Prueba de concepto (Fase 0): mide que SQLite funcione con las garantías del plan (sección 9.5):
//! modo WAL + synchronous=FULL (lo confirmado sobrevive a un apagón) e integrity_check al iniciar.

use std::time::Instant;
use tauri::Manager;

#[derive(serde::Serialize)]
struct Diagnostico {
    ruta: String,
    version_sqlite: String,
    journal_mode: String,
    synchronous: i64,
    integridad: String,
    filas_totales: i64,
    cuadre_centavos: i64,
    ms_insertar_10000: u128,
    ms_consulta_suma: u128,
}

fn texto<E: ToString>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn diagnostico_sqlite(app: tauri::AppHandle) -> Result<Diagnostico, String> {
    let dir = app.path().app_data_dir().map_err(texto)?;
    std::fs::create_dir_all(&dir).map_err(texto)?;
    let ruta = dir.join("poc.db");
    let mut con = rusqlite::Connection::open(&ruta).map_err(texto)?;

    let journal_mode: String = con
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .map_err(texto)?;
    con.execute_batch(
        "PRAGMA synchronous=FULL;
         CREATE TABLE IF NOT EXISTS lineas (
           id INTEGER PRIMARY KEY,
           cuenta TEXT NOT NULL,
           debito INTEGER NOT NULL CHECK (debito >= 0),
           credito INTEGER NOT NULL CHECK (credito >= 0)
         );",
    )
    .map_err(texto)?;
    let synchronous: i64 = con.query_row("PRAGMA synchronous", [], |r| r.get(0)).map_err(texto)?;
    let integridad: String = con.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(texto)?;
    let version_sqlite: String = con.query_row("SELECT sqlite_version()", [], |r| r.get(0)).map_err(texto)?;

    // 10.000 líneas en una sola transacción (5.000 asientos de $100,00 en centavos enteros).
    let t = Instant::now();
    {
        let tx = con.transaction().map_err(texto)?;
        {
            let mut st = tx
                .prepare("INSERT INTO lineas (cuenta, debito, credito) VALUES (?1, ?2, ?3)")
                .map_err(texto)?;
            for i in 0..10_000i64 {
                let (cuenta, d, c) = if i % 2 == 0 { ("111005", 10_000, 0) } else { ("413595", 0, 10_000) };
                st.execute(rusqlite::params![cuenta, d, c]).map_err(texto)?;
            }
        }
        tx.commit().map_err(texto)?;
    }
    let ms_insertar_10000 = t.elapsed().as_millis();

    let t = Instant::now();
    let (filas_totales, cuadre_centavos): (i64, i64) = con
        .query_row("SELECT COUNT(*), COALESCE(SUM(debito) - SUM(credito), 0) FROM lineas", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(texto)?;
    let ms_consulta_suma = t.elapsed().as_millis();

    Ok(Diagnostico {
        ruta: ruta.display().to_string(),
        version_sqlite,
        journal_mode,
        synchronous,
        integridad,
        filas_totales,
        cuadre_centavos,
        ms_insertar_10000,
        ms_consulta_suma,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![diagnostico_sqlite])
        .run(tauri::generate_context!())
        .expect("error al iniciar Contafi POC");
}
