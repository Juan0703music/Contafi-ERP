# Sincronización y autenticación

Guía para implementar el cliente (app de escritorio, Fase 3). El servidor ya está hecho y probado.

## Inicio de sesión y MFA (Supabase Auth, desde la app)

1. **Registro:** `supabase.auth.signUp({ email, password, options: { data: { nombre } } })`.
   Un trigger crea el perfil en `public.usuarios`.
2. **Crear la firma** (primer uso): `supabase.rpc('crear_firma', { p_nombre })`. Quien la crea es propietario.
3. **MFA obligatorio para administradores:** después de iniciar sesión, llamar `supabase.rpc('requiere_mfa')`.
   - Si responde `true` y el usuario no tiene factor: `supabase.auth.mfa.enroll({ factorType: 'totp' })`,
     mostrar el QR y verificar con `mfa.challengeAndVerify({ factorId, code })`.
   - Si ya tiene factor: pedir el código de 6 dígitos y hacer `challengeAndVerify`.
   - Mientras la sesión no sea `aal2`, un administrador **no ve ni administra** las empresas de su firma
     (la base lo hace cumplir, no la app).
4. **Crear empresas:** `supabase.rpc('crear_empresa', { p_firma, p_nit, p_dv, p_razon_social })`.
   Valida el dígito de verificación y carga el PUC de la plantilla y los tipos de comprobante.
5. **Invitar:** `POST /api/invitaciones` con `{ firma_id, correo, rol_firma, empresas: [{ empresa_id, rol }] }`.
   Llega un correo con un enlace a `/invitacion#token=…`; la persona pega el código en la app, que llama
   `supabase.rpc('aceptar_invitacion', { p_token })` con la sesión del invitado (el correo debe coincidir).
6. **Equipo** (solo administradores con MFA): `mis_firmas()`, `equipo_firma(p_firma)` (miembros con su rol
   en cada empresa e invitaciones pendientes), `asignar_rol_empresa(p_empresa, p_usuario, p_rol | null)`,
   `cambiar_rol_firma(p_firma, p_usuario, 'administrador' | 'miembro')`, `quitar_miembro(p_firma, p_usuario)`
   y `revocar_invitacion(p_id)`. Membresías y permisos ya no se escriben directamente (D-023).

7. **Recuperar la contraseña:** la app llama `supabase.auth.resetPasswordForEmail(correo, { redirectTo: '<URL_SITIO>/clave' })`.
   El correo lleva a la página `/clave` de `apps/web`, que lee la sesión de recuperación del fragmento (`#…`,
   no llega al servidor) y guarda la nueva contraseña con `auth.updateUser`. **En Supabase → Authentication →
   URL Configuration** hay que agregar `<URL_SITIO>/clave` a las *Redirect URLs* (si no, el enlace no funciona).

**En la app:** la pantalla de acceso tiene "Crear una cuenta" y "¿Olvidaste tu contraseña?". Un usuario sin empresas ve la bienvenida:
pegar el código de una invitación o crear su firma; al crearla, activa la verificación en dos pasos y
registra la primera empresa. Después, "Mis empresas → Nueva empresa" y "Equipo de la firma".

La API y la base de datos **nunca usan la llave `service_role`**: todo se hace con el token del usuario y RLS decide.

## Enviar la cola de salida — `POST /api/sync/enviar`

Encabezado `Authorization: Bearer <access_token de la sesión>`. Cuerpo (`@contafi/sync` → `loteEnvio`):

```json
{
  "version_protocolo": 1,
  "empresa_id": "uuid",
  "dispositivo": { "id": "uuid del PC", "nombre": "PC recepción", "version_app": "0.3.0" },
  "comprobantes": [{
    "id": "uuid creado en el PC", "tipo": "CG", "fecha": "2026-09-30", "concepto": "…",
    "origen": "manual", "clave_idempotencia": "pc:<uuid>",
    "lineas": [{ "cuenta": "111005", "debito": "1000.00", "credito": "0", "tercero_id": null }]
  }]
}
```

- Antes de los comprobantes, el lote puede traer los maestros creados sin conexión, que el servidor
  registra primero: `cuentas` (`codigo`, `nombre`, `exige_tercero`, `exige_centro_costo`, `activa`),
  `terceros` y `productos`. La respuesta trae un resultado por cada uno. Si una cuenta se rechaza
  (código inválido, padre con movimientos, saldo al inactivar, o el usuario no es contador ni
  administrador), viene con `actual`: la cuenta como está en el servidor (o `null`), para que el PC
  deshaga su cambio. Un rechazo de un maestro no detiene el lote.
- Máximo 200 comprobantes y 4 MB por envío: la app parte la cola.
- **Montos como texto** con máximo 2 decimales. Nunca `number`.
- Respuesta: un resultado por comprobante, en el mismo orden:
  `{ id, clave_idempotencia, estado: contabilizado | borrador | rechazado, numero, errores[], repetido }`.
- Qué hace la app con cada resultado:
  - `contabilizado`: reemplaza `CG-LOCAL-XXXX` por el número oficial.
  - `borrador`: queda esperando aprobación de un contador.
  - `rechazado`: lo muestra con los errores (por línea si aplica). Al corregirlo, genera una **nueva** clave.
- Si el envío se corta, se reenvía **igual** (misma clave): el servidor no duplica (`repetido: true`).
- Errores HTTP: 401 sesión vencida (renovar el token y reintentar), 402 suscripción vencida (modo consulta: no reintentar hasta renovar; lo pendiente se conserva), 403 sin permiso, 400 protocolo,
  413 lote muy grande, 5xx reintentar con espera creciente.

## Recibir cambios — `GET /api/sync/cambios?empresa_id=…&desde=<ultima_seq>&limite=500`

- Primera instalación: `desde=0`, repetir mientras `hay_mas` sea `true` (barra de progreso).
- Guardar `ultima_seq` solo después de aplicar la página en SQLite, dentro de una transacción.
- `registros` trae el estado **actual** de cada registro que cambió, por tabla (`cuentas`, `terceros`,
  `productos`, `centros_costo`, `periodos`, `tipos_comprobante`, `comprobantes` con sus `lineas`).
  La app hace upsert por clave: `codigo` (cuentas, tipos), `anio`+`mes` (períodos), `id` (el resto).
