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
