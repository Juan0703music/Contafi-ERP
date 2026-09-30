# Estado del proyecto

Última actualización: 30 de septiembre de 2026.

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
| Esquema de la sección 7 con migraciones, RLS y triggers de respaldo | ✅ núcleo contable, terceros, parámetros, documentos DIAN, auditoría, cambios · ⬜ facturas, inventario, tesorería |
| Motor: reglas de la sección 8, IVA, retenciones, documentos, kardex, reportes, cierre anual | ✅ |
| Corregir el error de fechas UTC del prototipo | ✅ `hoyBogota()` |
| Pruebas: unitarias y por propiedades (fast-check) | ✅ |
| Casos contables de referencia del asesor | 👤 ⬜ los prepara el asesor; se agregan como pruebas |
| RPC de sincronización: idempotencia, consecutivos, rechazo con motivo, cambios incrementales | ✅ en Postgres · ⬜ API en Vercel que revalide con el motor |
| Autenticación: registro, MFA e invitaciones | ⬜ |

**Criterio de salida:** 100 % de los casos del asesor correctos, pruebas por propiedades sin fallas (✅) y RLS probado en todas las tablas (🟡 probado en las contables).

## Hallazgos en el prototipo (corregidos en el motor)
1. `todayISO()` usaba la hora UTC y registraba el día siguiente después de las 7 p. m. → `hoyBogota()`.
2. Usaba la cuenta **135515** como "IVA descontable". En el PUC, 135515 es *Retención en la fuente*; el IVA descontable va en **240810**.
3. Los NIT de los datos de demostración tienen el dígito de verificación mal: 900.123.456 → **8** (no 7), 830.945.221 → **8** (no 3), 901.223.556 → **9** (no 1).
4. Montos en `number` redondeados a pesos → centavos exactos en `bigint`.
5. Consecutivos del lado del cliente → los asigna solo el servidor, sin huecos.
6. Carga Chart.js y las fuentes desde internet: sin conexión no hay gráficas. En la Fase 3 se empaquetan dentro de la app.

## Pruebas automáticas (30/09/2026)
- `@contafi/shared`: 12 ✓
- `@contafi/motor`: 28 ✓ (incluye propiedades: balance siempre cuadra, activo = pasivo + patrimonio antes y después del cierre, todo documento genera un asiento válido, el kardex no pierde centavos)
- `@contafi/dian-xml`: 11 ✓
- `supabase` (PGlite): 15 ✓ (consecutivos sin huecos, idempotencia, rechazos, período cerrado, inmutabilidad, auditoría solo-agregar, RLS entre firmas)
