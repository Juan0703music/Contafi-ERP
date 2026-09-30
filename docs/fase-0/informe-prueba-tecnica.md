# Informe de la prueba técnica (Fase 0)

Fecha: ____ · Responsable: ____

## Equipo de prueba (PC de gama baja)
- Modelo: ____ · RAM: ____ GB · Procesador: ____ · Windows: ____ · Disco: SSD / HDD

## 1. App de escritorio (Tauri + prototipo)
| Medida | Resultado | Meta / comentario |
|---|---|---|
| Tamaño del instalador .exe (NSIS) | | sin la IA; idealmente < 15 MB |
| Tamaño del .msi | | |
| Tiempo de arranque (página de diagnóstico) | | < 3 s |
| RAM en reposo (Contafi POC + msedgewebview2) | | |
| RAM usando el prototipo | | |
| SQLite: journal_mode / synchronous / integridad | | wal / 2 / ok |
| Insertar 10.000 líneas | | |
| Cierre forzado + reapertura: integridad y datos intactos | | ok, sin pérdidas |
| El prototipo funciona sin internet | | se sabe que las gráficas no cargan (CDN) |
| Aviso de SmartScreen | | esperado sin firma |

## 2. IA local (`probar-ia.ps1`)
| Medida | Resultado | Meta |
|---|---|---|
| Modelo y cuantización | | Qwen3-4B Q4_K_M |
| Tiempo de carga del modelo | | |
| Velocidad de generación (tg, t/s) | | |
| Pregunta 1 (bancos): tiempo / herramienta | | < 10 s / saldo_cuenta |
| Pregunta 2 (clientes): tiempo / herramienta | | < 10 s / saldo_cuenta |
| Pregunta 3 (explicación): tiempo / calidad del español | | < 10 s |
| RAM de llama-server | | < 4 GB en un PC de 8 GB |

**Decisión:** ☐ se sigue con 4B · ☐ se prueba un modelo más pequeño · ☐ la IA se deja para después

## 3. Importación de XML reales
Comando: `pnpm --filter @contafi/dian-xml leer <carpeta> <NIT de la empresa>`

| Medida | Resultado |
|---|---|
| Archivos probados | /20 |
| Leídos sin error | |
| Con advertencias (cuáles) | |
| Asientos propuestos correctos según el contador | |
| Casos no soportados encontrados | |

## Conclusiones y alcance del MVP
- ____
