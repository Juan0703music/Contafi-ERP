mod base;
mod llave;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(base::EstadoBase(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            base::abrir_base,
            base::cerrar_base,
            base::sql_consultar,
            base::sql_lote
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Contafi");
}
