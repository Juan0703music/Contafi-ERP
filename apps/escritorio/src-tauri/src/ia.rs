//! Asesor de IA local (sección 12 del plan).
//!
//! * El modelo NO va en el instalador: se descarga dentro de la app, se puede reanudar y se verifica
//!   con su huella SHA-256 (las URL y huellas vienen del catálogo fijo de la app, no de "la última versión").
//! * llama-server corre como proceso aparte, solo en 127.0.0.1, en un puerto aleatorio y con un token
//!   por sesión (sección 10). La app lo apaga cuando no se usa y al cerrarse.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct EstadoIA(pub Mutex<Option<Child>>);
/// Reconocimiento de voz (whisper-server), aparte de la IA: se enciende solo cuando se usa el micrófono.
pub struct EstadoVoz(pub Mutex<Option<Child>>);

fn texto<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn carpeta_ia(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(texto)?.join("ia");
    std::fs::create_dir_all(&dir).map_err(texto)?;
    Ok(dir)
}

/// Solo nombres simples: nada de rutas ni "..".
fn nombre_valido(nombre: &str) -> Result<(), String> {
    if nombre.is_empty() || nombre.contains(['/', '\\']) || nombre.contains("..") {
        return Err("Nombre de archivo inválido.".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Hardware {
    ram_gb: f64,
    nucleos: usize,
}

/// RAM y núcleos del PC, para elegir el nivel de IA (sección 12.2).
#[tauri::command]
pub fn ia_hardware() -> Hardware {
    let mut sistema = sysinfo::System::new();
    sistema.refresh_memory();
    let ram = sistema.total_memory() as f64 / 1_073_741_824.0;
    let nucleos = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    Hardware { ram_gb: (ram * 10.0).round() / 10.0, nucleos }
}

#[derive(Serialize)]
pub struct ArchivosIA {
    carpeta: String,
    archivos: Vec<String>,
    motor_instalado: bool,
    voz_instalada: bool,
    lector_instalado: bool,
}

fn buscar_archivo(dir: &Path, nombre: &str) -> Option<PathBuf> {
    for entrada in std::fs::read_dir(dir).ok()?.flatten() {
        let ruta = entrada.path();
        if ruta.is_dir() {
            if let Some(encontrado) = buscar_archivo(&ruta, nombre) {
                return Some(encontrado);
            }
        } else if ruta.file_name().is_some_and(|n| n == nombre) {
            return Some(ruta);
        }
    }
    None
}

const SERVIDOR: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
const SERVIDOR_VOZ: &str = if cfg!(windows) { "whisper-server.exe" } else { "whisper-server" };
const LECTOR: &str = if cfg!(windows) { "piper.exe" } else { "piper" };

/// Carpeta donde se extrae cada motor. Van separados: whisper.cpp y llama.cpp traen DLL de ggml con el
/// mismo nombre y de versiones distintas.
fn carpeta_motor(nombre: Option<&str>) -> Result<&'static str, String> {
    match nombre.unwrap_or("motor") {
        "motor" => Ok("motor"),
        "voz" => Ok("voz"),
        "piper" => Ok("piper"),
        _ => Err("Carpeta de destino inválida.".into()),
    }
}

/// Qué hay descargado (solo archivos completos y verificados; los parciales terminan en ".parcial").
#[tauri::command]
pub fn ia_archivos(app: AppHandle) -> Result<ArchivosIA, String> {
    let dir = carpeta_ia(&app)?;
    let archivos = std::fs::read_dir(&dir)
        .map_err(texto)?
        .flatten()
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.ends_with(".parcial"))
        .collect();
    let motor_instalado = buscar_archivo(&dir.join("motor"), SERVIDOR).is_some();
    let voz_instalada = buscar_archivo(&dir.join("voz"), SERVIDOR_VOZ).is_some();
    let lector_instalado = buscar_archivo(&dir.join("piper"), LECTOR).is_some();
    Ok(ArchivosIA { carpeta: dir.display().to_string(), archivos, motor_instalado, voz_instalada, lector_instalado })
}

fn sha256_de(ruta: &Path) -> Result<String, String> {
    let mut archivo = std::fs::File::open(ruta).map_err(texto)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = archivo.read(&mut buffer).map_err(texto)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn extraer_zip(zip: &Path, destino: &Path) -> Result<(), String> {
    let archivo = std::fs::File::open(zip).map_err(texto)?;
    let mut paquete = zip::ZipArchive::new(archivo).map_err(texto)?;
    for i in 0..paquete.len() {
        let mut entrada = paquete.by_index(i).map_err(texto)?;
        // enclosed_name descarta rutas peligrosas ("../", absolutas).
        let Some(relativa) = entrada.enclosed_name() else { continue };
        let ruta = destino.join(relativa);
        if entrada.is_dir() {
            std::fs::create_dir_all(&ruta).map_err(texto)?;
        } else {
            if let Some(padre) = ruta.parent() {
                std::fs::create_dir_all(padre).map_err(texto)?;
            }
            let mut salida = std::fs::File::create(&ruta).map_err(texto)?;
            std::io::copy(&mut entrada, &mut salida).map_err(texto)?;
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct Progreso {
    archivo: String,
    descargado: u64,
    total: u64,
}

fn descargar(app: &AppHandle, dir: &Path, url: &str, archivo: &str, sha256: &str, extraer: Option<&str>) -> Result<(), String> {
    let destino = dir.join(archivo);
    if destino.exists() {
        if sha256_de(&destino)?.eq_ignore_ascii_case(sha256) {
            return Ok(());
        }
        std::fs::remove_file(&destino).map_err(texto)?;
    }
    let parcial = dir.join(format!("{archivo}.parcial"));
    let ya = std::fs::metadata(&parcial).map(|m| m.len()).unwrap_or(0);

    let cliente = reqwest::blocking::Client::builder().timeout(None).build().map_err(texto)?;
    let mut pedido = cliente.get(url).header(reqwest::header::USER_AGENT, "Contafi");
    if ya > 0 {
        // Reanudar donde quedó (sección 12.2: descarga reanudable).
        pedido = pedido.header(reqwest::header::RANGE, format!("bytes={ya}-"));
    }
    let mut respuesta = pedido.send().map_err(|e| format!("No se pudo descargar: {e}"))?;
    let estado = respuesta.status();
    let reanuda = estado == reqwest::StatusCode::PARTIAL_CONTENT;
    if !estado.is_success() {
        return Err(format!("El servidor de descarga respondió {estado}."));
    }
    let mut descargado = if reanuda { ya } else { 0 };
    let total = respuesta.content_length().map(|l| l + descargado).unwrap_or(0);

    let mut opciones = std::fs::OpenOptions::new();
    opciones.create(true);
    if reanuda {
        opciones.append(true);
    } else {
        opciones.write(true).truncate(true);
    }
    let mut salida = opciones.open(&parcial).map_err(texto)?;
    let mut buffer = vec![0u8; 1 << 16];
    let mut ultimo_aviso = Instant::now();
    loop {
        let n = respuesta.read(&mut buffer).map_err(|e| format!("Se cortó la descarga (se puede reanudar): {e}"))?;
        if n == 0 {
            break;
        }
        salida.write_all(&buffer[..n]).map_err(texto)?;
        descargado += n as u64;
        if ultimo_aviso.elapsed().as_millis() > 300 {
            let _ = app.emit("ia-descarga", Progreso { archivo: archivo.to_string(), descargado, total });
            ultimo_aviso = Instant::now();
        }
    }
    salida.flush().map_err(texto)?;
    drop(salida);

    let real = sha256_de(&parcial)?;
    if !real.eq_ignore_ascii_case(sha256) {
        let _ = std::fs::remove_file(&parcial);
        return Err(format!("El archivo descargado no coincide con su huella SHA-256 (esperada {sha256}, obtenida {real}). Se descartó."));
    }
    std::fs::rename(&parcial, &destino).map_err(texto)?;
    if let Some(carpeta) = extraer {
        extraer_zip(&destino, &dir.join(carpeta))?;
    }
    let _ = app.emit("ia-descarga", Progreso { archivo: archivo.to_string(), descargado, total: descargado });
    Ok(())
}

/// Descarga un archivo del catálogo de IA, verifica su SHA-256 y, si es un motor (zip), lo extrae en su
/// carpeta ("motor" para llama.cpp, "voz" para whisper.cpp).
#[tauri::command]
pub async fn ia_descargar(
    app: AppHandle, url: String, archivo: String, sha256: String, extraer: bool, carpeta: Option<String>,
) -> Result<(), String> {
    nombre_valido(&archivo)?;
    let destino_zip = if extraer { Some(carpeta_motor(carpeta.as_deref())?) } else { None };
    if !url.starts_with("https://") {
        return Err("Solo se descarga por HTTPS.".into());
    }
    let dir = carpeta_ia(&app)?;
    tauri::async_runtime::spawn_blocking(move || descargar(&app, &dir, &url, &archivo, &sha256, destino_zip))
        .await
        .map_err(texto)?
}

#[derive(Serialize)]
pub struct Servidor {
    url: String,
    token: String,
}

fn detener(estado: &EstadoIA) {
    detener_proceso(&estado.0);
}

fn detener_proceso(proceso: &Mutex<Option<Child>>) {
    if let Ok(mut guardia) = proceso.lock() {
        if let Some(mut hijo) = guardia.take() {
            let _ = hijo.kill();
            let _ = hijo.wait();
        }
    }
}

/// Arranca llama-server con el modelo indicado, solo en 127.0.0.1, puerto aleatorio y token de sesión.
#[tauri::command]
pub fn ia_iniciar(app: AppHandle, estado: State<'_, EstadoIA>, modelo: String, hilos: Option<usize>) -> Result<Servidor, String> {
    nombre_valido(&modelo)?;
    let dir = carpeta_ia(&app)?;
    let servidor = buscar_archivo(&dir.join("motor"), SERVIDOR).ok_or("El motor de IA no está instalado.")?;
    let ruta_modelo = dir.join(&modelo);
    if !ruta_modelo.exists() {
        return Err("El modelo de IA no está descargado.".into());
    }
    detener(&estado);

    let puerto = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map_err(texto)?
        .port();
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(texto)?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let hilos = hilos.unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get().max(2) / 2).unwrap_or(2));

    let mut comando = Command::new(&servidor);
    comando
        .arg("-m").arg(&ruta_modelo)
        .args(["--host", "127.0.0.1", "--port", &puerto.to_string(), "--api-key", &token])
        // Un solo usuario por PC: un "slot", para que la caché de las instrucciones se reutilice siempre.
        .args(["-c", "4096", "-np", "1", "--jinja", "-t", &hilos.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(carpeta) = servidor.parent() {
        comando.current_dir(carpeta); // las DLL de llama.cpp están junto al ejecutable
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        comando.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sin ventana de consola
    }
    let hijo = comando.spawn().map_err(|e| format!("No se pudo iniciar la IA: {e}"))?;
    *estado.0.lock().map_err(texto)? = Some(hijo);
    Ok(Servidor { url: format!("http://127.0.0.1:{puerto}"), token })
}

/// Apaga la IA y libera la memoria.
#[tauri::command]
pub fn ia_detener(estado: State<'_, EstadoIA>) {
    detener(&estado);
}

#[derive(Serialize)]
pub struct ServidorVoz {
    url: String,
}

/// Arranca whisper-server (reconocimiento de voz local) solo en 127.0.0.1 y en un puerto aleatorio.
/// Recibe audio y devuelve texto; el audio no se guarda ni sale del PC.
#[tauri::command]
pub fn voz_iniciar(app: AppHandle, estado: State<'_, EstadoVoz>, modelo: String, pista: String, hilos: Option<usize>) -> Result<ServidorVoz, String> {
    nombre_valido(&modelo)?;
    if pista.len() > 600 {
        return Err("Pista de vocabulario demasiado larga.".into());
    }
    let dir = carpeta_ia(&app)?;
    let servidor = buscar_archivo(&dir.join("voz"), SERVIDOR_VOZ).ok_or("El reconocimiento de voz no está instalado.")?;
    let ruta_modelo = dir.join(&modelo);
    if !ruta_modelo.exists() {
        return Err("El modelo de voz no está descargado.".into());
    }
    detener_proceso(&estado.0);

    let puerto = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map_err(texto)?
        .port();
    let hilos = hilos.unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get().max(2) / 2).unwrap_or(2));
    let mut comando = Command::new(&servidor);
    comando
        .arg("-m").arg(&ruta_modelo)
        .args(["--host", "127.0.0.1", "--port", &puerto.to_string(), "-l", "es", "-t", &hilos.to_string()])
        // Preguntas cortas (hasta ~15 s): una ventana de audio menor que la de 30 s hace la respuesta 2× más rápida.
        .args(["-ac", "768", "--prompt", &pista])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(carpeta) = servidor.parent() {
        comando.current_dir(carpeta);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        comando.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let hijo = comando.spawn().map_err(|e| format!("No se pudo iniciar el reconocimiento de voz: {e}"))?;
    *estado.0.lock().map_err(texto)? = Some(hijo);
    Ok(ServidorVoz { url: format!("http://127.0.0.1:{puerto}") })
}

/// Lee un texto con una voz neuronal local (Piper) y devuelve el WAV. Un proceso por respuesta: carga la
/// voz (~60 MB) en menos de un segundo y no deja nada corriendo ni ningún puerto abierto.
#[tauri::command]
pub async fn voz_sintetizar(app: AppHandle, contenido: String, voz: String) -> Result<tauri::ipc::Response, String> {
    nombre_valido(&voz)?;
    if !voz.ends_with(".onnx") {
        return Err("Voz inválida.".into());
    }
    // Piper lee una línea por frase: todo en una sola línea para obtener un solo WAV.
    let frase = contenido.replace(['\r', '\n'], " ");
    if frase.trim().is_empty() || frase.len() > 4000 {
        return Err("No hay texto para leer o es demasiado largo.".into());
    }
    let dir = carpeta_ia(&app)?;
    let lector = buscar_archivo(&dir.join("piper"), LECTOR).ok_or("La voz de Jarvis no está instalada.")?;
    let modelo = dir.join(&voz);
    if !modelo.exists() || !dir.join(format!("{voz}.json")).exists() {
        return Err("Esa voz no está descargada.".into());
    }
    let wav = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut comando = Command::new(&lector);
        comando
            .arg("--model").arg(&modelo)
            .args(["--output_file", "-", "--sentence_silence", "0.25", "--length_scale", "0.95"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(carpeta) = lector.parent() {
            comando.current_dir(carpeta); // DLL y datos de espeak-ng junto al ejecutable
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            comando.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut hijo = comando.spawn().map_err(|e| format!("No se pudo iniciar la voz: {e}"))?;
        {
            let mut entrada = hijo.stdin.take().ok_or("No se pudo enviar el texto a la voz.")?;
            entrada.write_all(frase.as_bytes()).map_err(texto)?;
            entrada.write_all(b"\n").map_err(texto)?;
        } // al soltar la entrada, Piper sabe que no hay más texto
        let salida = hijo.wait_with_output().map_err(texto)?;
        if !salida.status.success() || salida.stdout.len() < 44 {
            return Err("La voz no pudo leer el texto.".into());
        }
        Ok(salida.stdout)
    })
    .await
    .map_err(texto)??;
    Ok(tauri::ipc::Response::new(wav))
}

/// Apaga el reconocimiento de voz y libera la memoria.
#[tauri::command]
pub fn voz_detener(estado: State<'_, EstadoVoz>) {
    detener_proceso(&estado.0);
}

/// Al cerrar la app no puede quedar llama-server ni whisper-server corriendo.
pub fn al_salir(app: &AppHandle) {
    if let Some(estado) = app.try_state::<EstadoIA>() {
        detener(&estado);
    }
    if let Some(estado) = app.try_state::<EstadoVoz>() {
        detener_proceso(&estado.0);
    }
}
