# Plan de incidentes de seguridad

Checklist de lanzamiento (sección 22 del plan): "Plan de incidentes de seguridad escrito". Este documento
dice **qué hacer, en qué orden y quién**, con los pasos técnicos propios de Contafi. Las obligaciones
legales (avisos a la SIC y a los titulares) están marcadas para **confirmar con el abogado**.

## 1. Qué es un incidente

Cualquier hecho que comprometa —o pueda comprometer— la confidencialidad, integridad o disponibilidad de
los datos de los clientes o de la plataforma. Ejemplos:

- Acceso de alguien sin permiso a datos de una firma (otra firma, un exempleado, un tercero).
- Robo o pérdida de un PC con Contafi instalado.
- Filtración de una llave (Supabase `service_role`, llave de firma del instalador, token de Resend).
- Comprobantes alterados o borrados fuera de las reglas (la base lo impide; si pasa, es un incidente).
- Caída prolongada del servicio o pérdida de datos en la nube.
- Un instalador o una actualización falsos circulando con el nombre de Contafi.

## 2. Niveles

| Nivel | Criterio | Tiempo de reacción |
|---|---|---|
| **Crítico** | Datos de clientes expuestos o alterados, llave `service_role` filtrada, instalador falso | Inmediato, a cualquier hora |
| **Alto** | PC robado o perdido, cuenta de administrador comprometida, caída de más de 1 hora | Menos de 4 horas |
| **Medio** | Intento fallido, vulnerabilidad sin explotar, error de permisos sin datos expuestos | Menos de 1 día hábil |

## 3. Roles

- **Responsable del incidente:** el fundador (hoy, una sola persona; ver el riesgo 9 del plan). Decide,
  coordina y comunica.
- **Apoyo técnico:** el desarrollador de apoyo acordado (pendiente) y el soporte de Supabase o Vercel si
  hace falta.
- **Asesoría legal:** el abogado, para notificaciones y obligaciones con titulares y autoridades.

Contactos (completar): fundador ______ · desarrollador de apoyo ______ · abogado ______ ·
soporte de Supabase (panel de la organización) · soporte de Vercel (panel del equipo).

## 4. Pasos (en este orden)

1. **Registrar**: abrir una nota con fecha y hora de detección, quién avisó y qué se sabe. Todo lo que
   se haga después se anota con su hora.
2. **Contener** (según el caso, sección 5). Primero detener el daño; después investigar.
3. **Preservar evidencia**: exportar la tabla `auditoria` (es de solo agregar), los registros de Supabase
   y de Vercel del período, y la tabla `cambios`. No borrar nada.
4. **Evaluar el alcance**: qué firmas, empresas, usuarios y datos; desde cuándo. La auditoría registra
   usuario, dispositivo, acción y el antes y el después de cada cambio.
5. **Erradicar y recuperar**: corregir la causa, rotar llaves, restaurar desde respaldo si hubo daño
   (sección 6) y verificar con la doble corrida o el balance que los datos quedaron bien.
6. **Notificar** (sección 7).
7. **Cerrar**: informe breve (qué pasó, causa, impacto, qué se cambió) y una prueba automática nueva si
   el incidente lo permite (como `test/seguridad.test.ts`).

## 5. Contención por tipo de incidente

**Cuenta comprometida (usuario o administrador)**
- En Supabase → Authentication → Users: cerrar sus sesiones (sign out) y, si hace falta, bloquearla.
- Pedirle cambiar la contraseña ("¿Olvidaste tu contraseña?") y volver a configurar la verificación en
  dos pasos (administradores).
- Si es un exempleado: un administrador de la firma lo quita en "Equipo de la firma" (pierde el acceso a
  todas las empresas; lo que registró queda en la auditoría).

**PC robado o perdido**
- La base del PC está cifrada (SQLCipher) con una llave protegida por Windows (DPAPI) en la cuenta del
  usuario: sin esa sesión de Windows no se puede leer. Si el PC quedó con la sesión abierta, se asume
  que los datos de ese PC están expuestos.
- Cerrar las sesiones del usuario en Supabase (el PC deja de sincronizar) y quitarle el acceso si no
  volverá a usar ese equipo.
- Lo que el PC no alcanzó a sincronizar se pierde con el equipo: recordar al cliente sincronizar a diario
  (la app alerta a los 7 días sin sincronizar).

**Llave filtrada**
- `service_role` o el secreto JWT de Supabase: rotarlos de inmediato en el panel (Settings → API). La app
  y la API **no** usan `service_role`; si apareció en algún lado es un incidente crítico.
- Llave `anon`: es pública por diseño (la protege RLS), pero si se rota hay que publicar una versión de
  la app con la nueva.
- Token de Resend: revocarlo y crear otro en Vercel.
- Llave de firma del instalador o de las actualizaciones: revocar el certificado, avisar a los clientes y
  publicar una versión firmada con la nueva llave.

**Datos alterados o borrados**
- Los comprobantes contabilizados no se pueden modificar (triggers de inmutabilidad; las correcciones son
  reversos). Si aun así hay alteraciones, suspender la firma afectada (`firmas.estado = 'suspendida'`:
  queda en modo consulta) mientras se investiga.

**Caída del servicio**
- Los PC siguen trabajando sin conexión: lo registrado queda en su cola y se envía al volver el servicio.
- Revisar el estado de Supabase y Vercel, y `/api/salud`. Informar a los clientes por WhatsApp.

## 6. Respaldos y restauración

- Nube: respaldos diarios de Supabase (plan Pro) con restauración a un punto en el tiempo (PITR, si se
  contrata). **Probar una restauración cada mes** en un proyecto aparte (checklist: "una restauración
  probada en el último mes") y anotar la fecha.
- PC: respaldo diario cifrado, se guardan los últimos 7; la app restaura sola si la base se daña y
  vuelve a sincronizar con la nube.

## 7. Notificaciones (confirmar con el abogado)

- **Titulares y clientes afectados:** avisar a las firmas afectadas qué pasó, qué datos y qué deben hacer
  (cambiar contraseñas, revisar movimientos). Sin demoras injustificadas.
- **Superintendencia de Industria y Comercio (SIC):** la Ley 1581 de 2012 exige reportar los incidentes
  de seguridad que afecten bases de datos personales (a través del Registro Nacional de Bases de Datos).
  Confirmar con el abogado el plazo y el procedimiento vigentes.
- **Proveedores:** avisar a Supabase o a Vercel si el incidente involucra su infraestructura.
- Guardar copia de cada notificación con su fecha.

## 8. Prevención (lo que ya hace Contafi)

- RLS en todas las tablas y auditoría automática de permisos en cada cambio (`test/seguridad.test.ts`).
- Verificación en dos pasos obligatoria para administradores; permisos por empresa y rol.
- La app y la API trabajan con el token de cada usuario; nunca con `service_role`.
- Base local cifrada; respaldos diarios; auditoría de solo agregar; comprobantes inmutables.
- Revisar este plan cada año y después de cada incidente.
