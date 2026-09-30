# Contafi ERP

Software contable para Colombia, multi-empresa y pensado para contadores. Es una app de Windows
con base local, se sincroniza con la nube, funciona sin internet e incluye un asesor de IA local.

- Plan completo: [`docs/Plan de proyecto - Contafi ERP.txt`](docs/Plan%20de%20proyecto%20-%20Contafi%20ERP.txt)
- Avance por fases: [`docs/ESTADO.md`](docs/ESTADO.md)
- Decisiones técnicas: [`docs/DECISIONES.md`](docs/DECISIONES.md)
- Protocolo de sincronización e inicio de sesión: [`docs/SINCRONIZACION-Y-AUTENTICACION.md`](docs/SINCRONIZACION-Y-AUTENTICACION.md)

## Estructura

```
packages/shared     Dinero en centavos (bigint), fechas America/Bogota, NIT y DV, PUC semilla
packages/motor      Motor contable puro: reglas de la sección 8, impuestos, documentos,
                    kardex por costo promedio, reportes y cierre anual
packages/dian-xml   Lectura de XML/ZIP de la DIAN (UBL 2.1 / AttachedDocument) y propuesta de asiento
packages/sync       Protocolo de sincronización (zod) y servicio: revalida con el motor y registra
packages/local      Base local del PC, cola de salida y cliente de sincronización (probado con SQLite real)
packages/ui         Sistema visual Liquid Glass del prototipo: estilos, íconos y fuentes locales
supabase/           Migraciones SQL: esquema, RLS, triggers, autenticación/MFA, invitaciones, sincronización
apps/web            Next.js en Vercel: /api/sync/enviar, /api/sync/cambios, /api/invitaciones, /api/salud
apps/escritorio     App de escritorio: Tauri (SQLCipher, llave en Windows, respaldos) + React
apps/poc-escritorio Fase 0: Tauri + prototipo actual + SQLite (WAL/FULL), script de prueba de IA
docs/               Plan, estado, decisiones, material de la Fase 0 y referencia (prototipo, diseño)
```

## Requisitos

- Node.js 22 o superior y pnpm 10 (`corepack enable` o `npm i -g pnpm`)
- Para compilar la app de escritorio: Windows con Rust (lo hace el CI en GitHub Actions)

## Comandos

```bash
pnpm install          # instala dependencias
pnpm test             # pruebas: motor, XML DIAN, sincronización y base de datos (Postgres en proceso con PGlite)
pnpm --filter @contafi/web dev   # API local (copie apps/web/.env.example como .env.local)
pnpm typecheck        # verificación de tipos

# Fase 0: leer XML reales de la DIAN (archivo, ZIP o carpeta) y ver el asiento propuesto
pnpm --filter @contafi/dian-xml leer ~/facturas 900123456
```

App de escritorio en el navegador (modo demostración, sin servidor):

```bash
pnpm --filter @contafi/escritorio dev      # abre http://localhost:1420/?demo
```

Instalador de Windows (en Windows con Rust y NASM, o descargándolo del CI):

```powershell
cd apps/escritorio
pnpm tauri build
```

Prueba de concepto de la Fase 0 (en Windows, con Rust instalado):

```powershell
cd apps/poc-escritorio
pnpm tauri build                  # genera el instalador .exe (NSIS) y .msi de la prueba
.\scripts\probar-ia.ps1           # prueba llama.cpp + modelo de 4B en el PC de 8 GB
```

## Reglas del código

- Montos siempre en centavos `bigint` (`@contafi/shared` → `aCentavos`, `aDecimal`). Nunca `number`.
- Fechas contables con `hoyBogota()`, nunca `toISOString()`.
- El motor no toca disco ni red: lo usan la app y el servidor.
- Valores que cambian cada año (UVT, tarifas, bases) vienen de tablas de parámetros, no del código.
- Nada contabilizado se edita ni se borra: se anula con un reverso.
