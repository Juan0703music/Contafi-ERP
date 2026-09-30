//! Llave de cifrado de la base local (sección 10 del plan).
//!
//! Es una llave aleatoria de 256 bits, creada la primera vez. En Windows se guarda en el Administrador
//! de credenciales, que la protege con DPAPI ligada al usuario de Windows: otro usuario del PC o alguien
//! que copie el archivo de la base no puede abrirla.

const SERVICIO: &str = "co.contafi.escritorio";
const CUENTA: &str = "llave-base-local";

fn nueva_llave() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(windows)]
pub fn obtener_o_crear(_dir: &std::path::Path) -> Result<String, String> {
    let entrada = keyring::Entry::new(SERVICIO, CUENTA).map_err(|e| e.to_string())?;
    match entrada.get_password() {
        Ok(llave) => Ok(llave),
        Err(keyring::Error::NoEntry) => {
            let llave = nueva_llave()?;
            entrada.set_password(&llave).map_err(|e| e.to_string())?;
            Ok(llave)
        }
        Err(e) => Err(format!("No se pudo leer la llave de la base en el almacén de Windows: {e}")),
    }
}

/// Fuera de Windows (solo desarrollo): la llave queda en un archivo junto a la base. NO es seguro.
#[cfg(not(windows))]
pub fn obtener_o_crear(dir: &std::path::Path) -> Result<String, String> {
    let _ = (SERVICIO, CUENTA);
    let ruta = dir.join("llave-desarrollo.txt");
    if let Ok(llave) = std::fs::read_to_string(&ruta) {
        return Ok(llave.trim().to_string());
    }
    let llave = nueva_llave()?;
    std::fs::write(&ruta, &llave).map_err(|e| e.to_string())?;
    Ok(llave)
}
