# Estado del proyecto

Última actualización: 2 de octubre de 2026.

Leyenda: ✅ hecho · 🟡 avanzado, falta una parte · ⬜ pendiente · 👤 lo tienes que hacer tú (o con el asesor o el abogado)

## Fase 0 — Validación y prueba de concepto (semanas 1–3)

| Tarea | Estado | Dónde |
|---|---|---|
| Lista de 20 contadores y 10 entrevistas | 👤 ⬜ | `docs/fase-0/contadores.csv`, `guion-entrevistas.md` |
| Contador asesor y 2–3 pilotos | 👤 ⬜ | |
| Verificar la marca "Contafi" (SIC, RUES, dominio) | 👤 ⬜ | `docs/fase-0/verificacion-marca.md` |
| Prueba técnica: Tauri + HTML actual + SQLite | 🟡 código listo; falta compilar y medir en Windows | `apps/poc-escritorio` |
| Prueba de IA: llama.cpp + modelo de 4B en un PC de 8 GB | 🟡 script listo; falta ejecutarlo en Windows | `apps/poc-escritorio/scripts/probar-ia.ps1` |
| Leer 20 XML reales de la DIAN | 🟡 lector y CLI probados con XML sintéticos; faltan los 20 reales | `packages/dian-xml` |
| Informe de la prueba técnica | ⬜ | `docs/fase-0/informe-prueba-tecnica.md` |

**Criterio de salida:** 5 de 10 contadores pagarían, 3 pilotos comprometidos y la IA responde en menos de 10 s.

## Fase 1 — Empresa y legal (semanas 2–8) · 👤 todo
Constituir la SAS, sacar el RUT, abrir la cuenta y activar la facturación electrónica; registrar la marca (SIC) y el software (DNDA); con el abogado, términos,
licencia, política de datos y contrato de transmisión; con el contador, IVA del servicio y régimen; cotizar el certificado de firma de código.

## Fase 2 — Núcleo: motor y servidor (semanas 4–11) · adelantada

| Tarea | Estado |
|---|---|
| Monorepo (pnpm) y CI (GitHub Actions) | ✅ (falta subirlo a GitHub) |
| Entornos de Supabase (desarrollo, pruebas, producción) | 👤 ⬜ crear los proyectos |
| Esquema de la sección 7 con migraciones, RLS y triggers de respaldo | ✅ núcleo contable, terceros, parámetros, documentos DIAN, auditoría, cambios, productos e inventario · ⬜ tesorería en el servidor (hoy los extractos son locales) |
| Motor: reglas de la sección 8, IVA, retenciones, documentos, kardex, reportes, cierre anual | ✅ |
| Corregir el error de fechas UTC del prototipo | ✅ `hoyBogota()` |
| Pruebas: unitarias y por propiedades (fast-check) | ✅ |
| Casos contables de referencia del asesor | 👤 ⬜ los prepara el asesor; se agregan como pruebas |
| RPC de sincronización: idempotencia, consecutivos, rechazo con motivo, cambios incrementales | ✅ |
| API en Vercel (`apps/web`): envío y recepción, revalidando con el motor | ✅ probada contra Postgres (PGlite) y con HTTP real · ⬜ probar contra un Supabase real |
| Autenticación: registro, MFA obligatorio para administradores, alta de firmas y empresas, invitaciones por correo | ✅ servidor y pantallas |
| Límite de peticiones a la API | ⬜ configurar Vercel Firewall al desplegar |

**Criterio de salida:** 100 % de los casos del asesor correctos, pruebas por propiedades sin fallas (✅) y RLS probado en todas las tablas (🟡 probado en las contables, en invitaciones y en dispositivos).

## Fase 3 — Aplicación de escritorio (semanas 12–19) · adelantada

| Tarea | Estado |
|---|---|
| Proyecto Tauri + React; diseño Liquid Glass en componentes | ✅ `apps/escritorio`, mismo CSS del prototipo, fuentes locales, tema claro/oscuro y "reducir transparencia" |
| Capa local: SQLite cifrado, migraciones, cola de salida, autoguardado, respaldo diario, integridad | ✅ lógica en `@contafi/local` (probada) · 🟡 Rust con SQLCipher + llave en Windows + respaldos: escrito, **falta compilarlo en Windows (CI)** |
| Sincronización con indicadores (en línea, sin conexión, pendientes, rechazados) | ✅ automática al abrir, cada minuto, al volver la red y al guardar |
| Pantallas base: empresas, PUC, terceros, comprobantes, balances | ✅ panel, comprobantes (con autoguardado), plan de cuentas, balance de prueba, terceros (con importación masiva desde CSV), sincronización, libros y estados financieros |
| Inicio de sesión con MFA | ✅ pantalla lista, con registro de cuenta · ⬜ probar contra un Supabase real |
| Alta en la nube desde la app | ✅ bienvenida (crear firma → verificación en dos pasos → primera empresa, o unirse con el código de la invitación), nueva empresa y equipo de la firma (invitar, roles por empresa, quitar; D-023), recuperar contraseña (página `/clave` del sitio) · ⬜ probar contra un Supabase real · 👤 agregar `<URL_SITIO>/clave` a las Redirect URLs de Supabase |
| Modo demostración para pilotos (sin servidor) | ✅ `?demo`, con servidor simulado que asigna números |
| Instalador firmado, actualizaciones automáticas y Sentry | ✅ **el CI compila el instalador de Windows** (`.exe` de 4,9 MB y `.msi` de 6,1 MB, incluye SQLCipher) · ⬜ firma (certificado), actualizador (llaves) y Sentry (DSN) |

**Criterio de salida:** pasan las pruebas de cortes de red y de energía (✅ en `@contafi/local`) e instalación limpia en Windows 10 y 11 (👤 ⬜ descargar el instalador de GitHub Actions y probarlo en un PC con Windows).

## Fase 4 — Funciones contables completas del MVP (semanas 20–27) · adelantada

| Tarea | Estado |
|---|---|
| Importación de XML/ZIP de la DIAN con reglas por proveedor | ✅ duplicados por CUFE (también entre PC), tercero automático, cuenta y retenciones aprendidas por proveedor y compartidas entre los PC de la empresa (también sin conexión; D-025) |
| Retenciones e ICA | ✅ conceptos configurables por empresa (sin tarifas en el código), UVT por año; compartidos por el servidor entre todos los PC (D-024) |
| Cierres mensuales y anual | ✅ |
| Saldos iniciales | ✅ desde CSV (Excel), con validación por fila |
| Conciliación bancaria con importación de extractos | ✅ CSV de los bancos (valor con signo o débito/crédito), emparejamiento automático, manual, y registro de cargos desde el extracto · ⬜ formatos específicos por banco si alguno no se reconoce |
| Reportes NIIF y libros en PDF y Excel | ✅ libro diario, mayor y balances, auxiliares (por cuenta y tercero), auxiliar de impuestos por período (IVA generado/descontable y retenciones con base, por tercero para certificados), situación financiera y resultados · ⬜ flujo de efectivo y cambios en el patrimonio (versión 1.x) |
| Panel multi-empresa del contador | ✅ pendientes, alertas y vencimientos (calendario tributario que el contador carga desde el decreto del año; obligaciones por empresa; último dígito del NIT; D-026) · 👤 ⬜ cargar el calendario del decreto vigente |
| Ventas y compras manuales (sin facturación electrónica propia) | ✅ factura de venta y de compra con IVA por tarifa y retenciones, cartera por edades (FIFO), recaudos y pagos parciales |
| Inventario básico | ✅ productos, kárdex por costo promedio derivado de los asientos (débito = entrada, crédito = salida), costo de ventas automático al facturar, aviso de existencias negativas; sincroniza entre PC |
| Terceros: responsabilidades fiscales e importación masiva | ✅ edición con responsabilidades del RUT (O-13, O-15, O-23, O-47, R-99-PN), municipio y dirección; importación desde CSV (Excel) que calcula el DV, valida por fila con los mismos límites del servidor y omite los que ya existen |
| PUC personalizable | ✅ crear cuentas, subcuentas y auxiliares (heredan la naturaleza), editar e inactivar; también sin conexión; reglas en el servidor (D-022) |

**Criterio de salida:** el asesor valida los reportes con una empresa real de prueba (👤 ⬜).

## Fase 5 — Jarvis v1 (semanas 28–31) · adelantada

| Tarea | Estado |
|---|---|
| Proceso auxiliar llama.cpp, descarga del modelo y detección de hardware | ✅ en Rust (compila en Windows): descarga reanudable con SHA-256, RAM, 127.0.0.1 + puerto aleatorio + token, apagado al salir y tras 5 min sin uso · 👤 ⬜ probarlo en un PC con Windows |
| Herramientas de solo lectura (12.3) y motor de alertas (12.4) | ✅ 15 herramientas (incluye inventario bajo y próximos vencimientos) y alertas por reglas (incluye existencias negativas y vencimientos tributarios de los próximos 7 días) |
| Banco de preguntas y evaluación (12.5) | ✅ 46 preguntas y `pnpm --filter @contafi/jarvis evaluar` · 👤 ⬜ ampliar a 150 preguntas reales del piloto |
| Voz (adelantada de la versión 1.x) | ✅ hablarle a Jarvis con el micrófono (whisper.cpp `small`, local, ~3 s por pregunta) y respuestas con voces neuronales locales Piper (Claude, Ald, Daniela) o la del sistema; modo manos libres (D-028) · 👤 ⬜ probar en Windows |

**Medición real** (Qwen3-4B Q4_K_M en un portátil i5-8265U, 4 núcleos, sin tarjeta gráfica; Linux):

| Modo | Herramienta correcta | Cifras verificadas | Tiempo promedio | Máximo |
|---|---|---|---|---|
| Todo con IA, instrucciones v1 | 76,2 % | 95,2 % | 27,6 s | 98,6 s |
| Todo con IA, instrucciones v2 | 100 % | 100 % | 30,9 s | 69,3 s |
| **Híbrido (como la app)** | **100 %** | 97,6 % → 100 % tras dar los totales en la herramienta | **4,2 s** | 74,1 s |
| Qwen3 1,7B Q8_0, todo con IA | 60,9 % (28,3 % antes del reintento ampliado) | 80,4 % | 22,9 s | 52,3 s |
| Qwen3 1,7B Q8_0, híbrido | 100 % | 100 % | 2,6 s | 47,1 s |

- Leer instrucciones y herramientas toma ~85 s la primera vez; queda en la caché (después, 4,5 s). La app lo hace al abrir Jarvis.
- El servidor de IA usa ~4,6 GB de RAM con el modelo de 4B.
- La verificación de cifras atrapó dos cifras inventadas por el modelo (sumas que no pidió nadie).
- **Criterio de salida:** con el modo híbrido se cumplen las metas de precisión y el promedio < 10 s; las preguntas que sí requieren la IA tardan 30–80 s en este procesador.
- **Modelo más pequeño (evaluado):** Qwen3 1,7B usa la mitad de RAM (2,2 GB), pero cuando la pregunta le llega a la IA inventa cifras absurdas o escribe la herramienta como texto. No entra al catálogo: 4B es el mínimo para la IA y con menos de 8 GB se usan las reglas (D-027). De la evaluación salieron dos mejoras para todos los modelos: reintento con herramienta obligatoria cuando el modelo responde sin consultar datos, y una llamada a herramienta cortada se responde por reglas sin reiniciar la IA.
- 👤 ⬜ medir en el PC Windows de 8 GB del piloto.

## Fase 6 — Piloto (semanas 32–40) · herramientas en curso

| Tarea | Estado |
|---|---|
| Instalación y bienvenida de 3 contadores, con migración asistida de sus saldos | ✅ bienvenida en la nube; migración desde CSV: plan de cuentas (crea solo lo que falta, de padre a hijo), terceros, y saldos iniciales que crean los terceros que falten · 👤 instalar con los pilotos |
| Doble corrida durante 2 cierres mensuales | ✅ pantalla "Doble corrida": compara el balance de Contafi con el del software anterior (CSV de Siigo, World Office, Helisa…) a la fecha de corte, a cualquier nivel del PUC · 👤 hacer los 2 cierres con los pilotos |
| Corregir errores y medir la sincronización y la carga de soporte | ✅ métricas de sincronización por empresa (operaciones, rechazos, fallos de red, errores por cada 1.000 operaciones) y "Copiar diagnóstico" para soporte, sin montos ni nombres · 👤 medir con los pilotos |
| Recoger testimonios | 👤 ⬜ |

**Criterio de salida:** cero diferencias en los 2 cierres (sección 13) y pilotos dispuestos a pagar (👤).

## Fase 7 — Lanzamiento comercial (semanas 41–46) · ⬜

| Tarea | Estado |
|---|---|
| Sitio web con precios, descarga, documentación y videos | ✅ `apps/web`: inicio, precios (leídos de la tabla `planes`, "+ IVA"), descargar (requisitos y SmartScreen), ayuda con 11 guías y soporte · ⬜ videos · 👤 publicar el instalador y configurar correo, WhatsApp y horario (`.env.example`) |
| Cobro recurrente y facturación electrónica de las suscripciones | 🟡 planes y límites en el servidor (prueba de 30 días, Independiente, Firma, Firma Plus, empresas adicionales; precios en una tabla), aviso de vencimiento y modo consulta (D-029) · ⬜ conectar la pasarela de pagos (marca `pagado_hasta`) · 👤 cuenta en Wompi o ePayco y facturación electrónica propia |
| Canal de soporte y base de conocimiento | ✅ página de soporte (tiempos de respuesta del plan, diagnóstico) y base de conocimiento · 👤 WhatsApp Business y correo de soporte |
| Checklist de la sección 22 | ⬜ (ver el plan) |
| Campaña a contadores | 👤 ⬜ |

## Hallazgos en el prototipo (corregidos en el motor)
1. `todayISO()` usaba la hora UTC y registraba el día siguiente después de las 7 p. m. → `hoyBogota()`.
2. Usaba la cuenta **135515** como "IVA descontable". En el PUC, 135515 es *Retención en la fuente*; el IVA descontable va en **240810**.
3. Los NIT de los datos de demostración tienen el dígito de verificación mal: 900.123.456 → **8** (no 7), 830.945.221 → **8** (no 3), 901.223.556 → **9** (no 1).
4. Montos en `number` redondeados a pesos → centavos exactos en `bigint`.
5. Consecutivos del lado del cliente → los asigna solo el servidor, sin huecos.
6. Carga Chart.js y las fuentes desde internet: sin conexión no hay gráficas. En la Fase 3 se empaquetan dentro de la app.

## Hallazgos en el servidor y en la app (corregidos)
1. Con los privilegios por defecto de Supabase, cualquier usuario podía ejecutar `contabilizar_interno` y contabilizar borradores ajenos saltándose los permisos. Corregido en la migración `0200` (D-011).
2. Dos usuarios que comparten un PC no podían sincronizar. Corregido en la migración `0300` (D-010).
3. Un tercero creado sin conexión y usado en un comprobante habría sido rechazado por el servidor. Ahora viaja en el lote (D-014).
4. "1.234" escrito por el usuario se leía como 1,23. Ahora `leerMontoUsuario` lo lee como 1.234 pesos.
5. En la Fase 0 se había copiado el prototipo equivocado (sin Liquid Glass). Corregido (D-016).
6. La misma factura DIAN importada en dos PC dejaba dos copias en el segundo PC. Corregido con `id_servidor` (verificado con sabotaje).
7. Las notas crédito no reversaban la retención cuando su valor no alcanzaba la base mínima. Ahora se reversa (la base se evalúa en la factura original).
8. El emparejamiento bancario tomaba parejas lejanas por orden de llegada. Ahora prioriza las más cercanas en fecha.
9. En las ventanas modales, escribir en un campo que no fuera el primero hacía saltar el foco (en "Cargar extracto" solo quedaba el primer dígito del saldo). Corregido.
10. 10 campos no tenían estilo porque el CSS del prototipo solo aplica a `input[type=text]`.
11. El CI cancelaba la compilación de Windows con cada push nuevo. Corregido.
12. La versión "latest" de llama.cpp en GitHub no trae binarios: el script de la Fase 0 habría fallado. Ahora usa una versión fija verificada.
13. El modelo pequeño tendía a responder con otra pregunta en lugar de consultar los datos (8 de 10 fallos): instrucciones con ejemplos y reintento con herramienta obligatoria.
14. Un producto creado sin conexión por un contador (que en inventario solo tiene lectura) hacía fallar el lote entero con "sin permiso", y la cola se habría atascado para siempre. Ahora se rechaza solo ese registro (también para cuentas y terceros).
15. La tabla del plan de cuentas usaba un estilo del prototipo pensado para filas sueltas (`display:flex` en `<tr>`) y las columnas no quedaban alineadas.
16. Un administrador (no propietario) podía quitarle la firma al propietario escribiendo directamente en las membresías. Corregido (D-023).
17. La base mínima en UVT admite 3 decimales, pero el cálculo la redondeaba a 2 (0,125 UVT se tomaba como 0,13). Ahora usa milésimas exactas.
18. La plantilla del PUC no traía todos los grupos del Decreto 2650 (12 Inversiones, 16 Intangibles, 26 Pasivos estimados, 32 a 35 del patrimonio, clases 7 a 9…). Como las empresas no crean grupos, una empresa con esas cuentas no podía migrar. Ahora trae las 9 clases y sus 52 grupos, que nunca reciben movimientos ni se editan (antes se podía renombrar o inactivar un grupo).

## Pruebas automáticas (02/10/2026) — 235 en total
- `@contafi/shared`: 15 ✓
- `@contafi/motor`: 56 ✓ (propiedades: balance siempre cuadra, activo = pasivo + patrimonio antes y después del cierre, ESF = balance general, todo documento genera un asiento válido, el kardex no pierde centavos, la conciliación nunca usa un movimiento dos veces, el auxiliar de impuestos coincide con el balance, la doble corrida de los libros contra sí mismos da cero diferencias)
- `@contafi/dian-xml`: 11 ✓
- `@contafi/sync`: 25 ✓
- `@contafi/local`: 55 ✓ (sección 13: dos PC sin conexión, cortes de red y de energía, reinstalación; importación DIAN, retenciones, cierres, saldos iniciales, conciliación, panel multi-empresa, ventas, inventario, importación de terceros, plan de cuentas, configuración tributaria y reglas por proveedor compartidas)
- `supabase` (PGlite con privilegios de Supabase): 52 ✓
- `@contafi/jarvis`: 21 ✓
- `apps/web`: compila; rutas probadas por HTTP
- `apps/escritorio`: compila; en CI se genera el instalador de Windows. Recorrido de punta a punta en Firefox con 22 verificaciones automáticas (`pnpm --filter @contafi/escritorio e2e`)
- Pruebas verificadas con sabotaje: idempotencia del servidor y copias duplicadas entre PC
