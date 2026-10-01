# Decisiones técnicas

Registro corto de decisiones. Si una cambia, se agrega una nueva entrada; no se borra la anterior.

## D-001 · Dinero en centavos `bigint` (2026-09-30)
Todos los montos del motor son `bigint` en centavos. En Postgres, `numeric(18,2)`. Las tarifas van en
millonésimas (19 % = 190.000) para representar sin pérdida tarifas como 4,14 por mil o 0,966 %.
Redondeo: mitad alejándose de cero, a centavos. El IVA se redondea por tarifa (como el TaxSubtotal
del XML UBL). **Pendiente:** que el contador asesor confirme esta política (regla 8).

## D-002 · Las escrituras contables pasan por funciones de Postgres (2026-09-30)
Los clientes no pueden insertar ni actualizar `comprobantes`, `lineas`, `consecutivos`, `periodos`,
`auditoria` ni `cambios`: no tienen privilegios y RLS no tiene políticas de escritura. Todo pasa por
`registrar_comprobante`, `aprobar_comprobante`, `anular_comprobante` y `cambiar_estado_periodo`,
que son idempotentes, validan y dejan auditoría. La API en Vercel revalida con `@contafi/motor`
antes de llamar al RPC, así que se valida dos veces. Además, los triggers garantizan la partida
doble y la inmutabilidad aunque alguien tenga acceso de administrador.

## D-003 · Un comprobante anulado sigue en libros (2026-09-30)
Al anular, el original pasa a `anulado` y se crea un reverso `contabilizado` con `reversa_de`.
Los reportes suman ambos estados (`EN_LIBROS`), que se neutralizan. Así los libros conservan la
historia completa.

## D-004 · El usuario sin permiso de aprobar deja borradores (2026-09-30)
Un auxiliar contable (nivel CREATE) registra comprobantes que quedan en `borrador` en el servidor,
sin número. Un contador (APPROVE) los aprueba y en ese momento reciben su consecutivo.

## D-005 · En las compras importadas, las retenciones las calcula la empresa, no el XML (2026-09-30)
Las retenciones que trae el XML (`WithholdingTaxTotal`) son informativas. La propuesta de asiento
calcula las retenciones con los conceptos configurados para el proveedor y avisa si el XML trae
retenciones y no hay conceptos configurados.

## D-006 · Comprobante de cierre anual (2026-09-30)
Tiene `origen = 'cierre_anual'` y fecha del 31 de diciembre. Cancela las clases 4 a 7 por cuenta,
tercero y centro de costo contra 360505 (utilidad) o 361005 (pérdida). El estado de resultados lo
excluye para que el resultado del año no aparezca en cero. **Pendiente:** confirmar con el asesor si
se prefiere un "período 13".

## D-007 · Prueba de concepto con el prototipo sin cambios (2026-09-30)
La Fase 0 empaqueta el HTML actual tal cual en Tauri para medir tamaño, arranque, RAM y SQLite.
No se reescribe ninguna pantalla antes de validar el nicho.

## D-008 · MFA exigido en la base de datos (2026-09-30)
Un propietario o administrador solo ejerce como tal si la sesión es `aal2` (TOTP verificado).
`es_admin_firma()` lo exige y de ella dependen `rol_en_empresa`, RLS y las funciones de
administración. La app consulta `requiere_mfa()` para saber si debe pedir el código.

## D-009 · La API actúa como el usuario, nunca con service_role (2026-09-30)
Las rutas de Vercel crean el cliente de Supabase con la llave pública y el token de la sesión.
Si la API tuviera un error, RLS sigue protegiendo los datos.

## D-010 · Un PC compartido por varios usuarios (2026-09-30)
`dispositivos` tiene la clave primaria (id del PC, usuario). Lo encontraron las pruebas de sincronización:
con la clave original, el segundo usuario de un mismo PC no podía sincronizar.

## D-011 · Las pruebas imitan los privilegios por defecto de Supabase (2026-09-30)
Supabase otorga EXECUTE sobre toda función nueva de `public` a `anon` y `authenticated`. La primera
migración dejó `contabilizar_interno` (que no revisa permisos) invocable por cualquier usuario; la
migración `0200` lo corrige. Las pruebas ahora arrancan con esos privilegios por defecto para detectar
estos olvidos. Regla: toda función SECURITY DEFINER que no revise permisos se revoca de
`public, anon, authenticated`.

## D-012 · Plantilla del PUC generada desde TypeScript (2026-09-30)
`supabase/migrations/…_plantilla_puc.sql` se genera desde `packages/shared/src/puc.ts`
(`pnpm --filter @contafi/supabase generar-puc`). Una prueba falla si se desincronizan.

## D-013 · La lógica local vive en TypeScript sobre una interfaz SQL mínima (2026-09-30)
`@contafi/local` (cola de salida, sincronización, reportes locales) solo necesita `consultar` y
`lote` (transacción atómica). Rust implementa esas dos operaciones con SQLCipher; las pruebas usan
node:sqlite y el modo demostración usa SQLite en WebAssembly. Así casi todo se prueba sin compilar
Rust, y Rust queda pequeño: cifrado, llave, integridad y respaldos.
Consecuencia: los montos se leen con `CAST(x AS TEXT)` (el puente JSON no tiene bigint).

## D-014 · Terceros creados sin conexión (2026-09-30)
El lote de sincronización lleva los terceros antes que los comprobantes. Si dos PC crean el mismo
documento, el servidor devuelve el id que ya tenía y el PC reescribe sus referencias. Gana el último
cambio confirmado; el anterior queda en auditoría (sección 9.4).

## D-015 · La app reutiliza el CSS del prototipo aprobado (2026-09-30)
`packages/ui/src/contafi.css` es copia del sistema Liquid Glass del prototipo (mismas clases), con las
fuentes Geist empaquetadas (sin Google Fonts: funciona sin internet). Los ajustes propios van en
`apps/escritorio/src/app.css`, sin editar la copia.

## D-016 · Prototipo de referencia corregido (2026-09-30)
En la Fase 0 se copió por error la versión original del prototipo (Descargas) en lugar de la rediseñada
con Liquid Glass (Documentos). Se corrigió: `docs/referencia/prototipo-liquid-glass.html` es ahora la
correcta y la original quedó como `prototipo-original.html`. La lógica del motor es idéntica en ambas.

## D-017 · Parámetros tributarios configurados por el contador (2026-09-30)
UVT por año y conceptos de retención (tarifa, base mínima en UVT, cuenta) se guardan por empresa en la
base local; Contafi no trae valores escritos. Pendiente: sincronizarlos entre PC por el servidor.

## D-018 · Período de la conciliación bancaria (2026-09-30)
Por defecto va del primer día del mes del extracto a su última fecha (editable): así los movimientos
de libros de los primeros días del mes pueden emparejarse aunque el banco los registre después.
La diferencia se calcula como: saldo extracto − (saldo libros − partidas de libros en tránsito +
partidas del banco sin registrar).

## D-019 · Jarvis: la IA elige y explica; el motor calcula; las cifras se verifican (2026-10-01)
El modelo solo elige herramientas de solo lectura y redacta. Cada herramienta registra las cifras
que devuelve y la respuesta se revisa: si trae un monto que no vino de una herramienta, la app lo
marca "Cifra no verificada". Las alertas proactivas las calculan reglas, no la IA.

## D-020 · Catálogo de IA fijo y verificado (2026-10-01)
El motor (llama.cpp) y los modelos se descargan de URL fijas con su SHA-256 (catálogo en
`apps/escritorio/src/datos/ia.ts`). No se usa "la última versión": la versión marcada como `latest`
de llama.cpp en GitHub no trae binarios, y descargar algo distinto cada vez rompe la reproducibilidad.
Modelos: Qwen3 4B (8–15 GB de RAM) y 8B (16 GB o más), licencia Apache 2.0.

## D-021 · Instrucciones fijas, calentamiento y camino rápido (2026-10-01)
Medido en un i5-8265U: leer las instrucciones y las 13 herramientas (~1.900 tokens) toma más de un
minuto; después el modelo genera unas 4–5 palabras por segundo. Por eso: (1) las instrucciones no
llevan empresa ni fecha (van en la pregunta), así quedan en la caché del modelo para siempre;
(2) al abrir Jarvis se "calienta" el modelo; (3) las preguntas cortas con una intención clara las
responden las reglas al instante; la IA atiende lo demás (redacciones nuevas, seguimientos).
