mod base;
mod ia;
mod llave;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(base::EstadoBase(Mutex::new(None)))
        .manage(ia::EstadoIA(Mutex::new(None)))
        .manage(ia::EstadoVoz(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            base::abrir_base,
            base::cerrar_base,
            base::sql_consultar,
            base::sql_lote,
            ia::ia_hardware,
            ia::ia_archivos,
            ia::ia_descargar,
            ia::ia_iniciar,
            ia::ia_detener,
            ia::voz_iniciar,
            ia::voz_detener,
            ia::voz_sintetizar
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar Contafi")
        .run(|app, evento| {
            if let tauri::RunEvent::Exit = evento {
                ia::al_salir(app);
            }
        });
}
