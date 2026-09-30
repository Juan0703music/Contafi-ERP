import { CUENTAS_POR_DEFECTO, type FechaISO } from '@contafi/shared';
import { EN_LIBROS, type Comprobante, type Linea } from './tipos.ts';

/**
 * Regla 10: el cierre anual cancela las cuentas de resultado (clases 4, 5, 6 y 7) contra la cuenta
 * de resultado del ejercicio (3605 utilidad / 3610 pérdida). Cancela por cuenta, tercero y centro de
 * costo para que los auxiliares también queden en cero.
 * Devuelve las líneas; el comprobante lo crea quien llama (fecha 31 de diciembre, tipo de cierre).
 */
export function lineasCierreAnual(
  comprobantes: readonly Comprobante[],
  anio: number,
  cuentas: { utilidad: string; perdida: string } = {
    utilidad: CUENTAS_POR_DEFECTO.utilidadEjercicio,
    perdida: CUENTAS_POR_DEFECTO.perdidaEjercicio,
  },
): { lineas: Linea[]; utilidadNeta: bigint } {
  const corte: FechaISO = `${anio}-12-31`;
  const saldos = new Map<string, { cuenta: string; terceroId: string | null; centroCostoId: string | null; saldo: bigint }>();
  for (const c of comprobantes) {
    if (!EN_LIBROS.has(c.estado) || c.fecha > corte) continue;
    for (const l of c.lineas) {
      if (!/^[4-7]/.test(l.cuenta)) continue;
      const clave = `${l.cuenta}|${l.terceroId ?? ''}|${l.centroCostoId ?? ''}`;
      const s = saldos.get(clave) ?? { cuenta: l.cuenta, terceroId: l.terceroId ?? null, centroCostoId: l.centroCostoId ?? null, saldo: 0n };
      s.saldo += l.debito - l.credito;
      saldos.set(clave, s);
    }
  }
  const lineas: Linea[] = [];
  let neto = 0n; // débito − crédito de todas las cuentas de resultado; negativo = utilidad
  for (const s of [...saldos.values()].sort((a, b) => a.cuenta.localeCompare(b.cuenta))) {
    if (s.saldo === 0n) continue;
    neto += s.saldo;
    lineas.push({
      cuenta: s.cuenta, terceroId: s.terceroId, centroCostoId: s.centroCostoId,
      debito: s.saldo < 0n ? -s.saldo : 0n, credito: s.saldo > 0n ? s.saldo : 0n,
      nota: 'Cierre de cuentas de resultado',
    });
  }
  const utilidadNeta = -neto;
  if (utilidadNeta > 0n) lineas.push({ cuenta: cuentas.utilidad, debito: 0n, credito: utilidadNeta, nota: 'Utilidad del ejercicio' });
  else if (utilidadNeta < 0n) lineas.push({ cuenta: cuentas.perdida, debito: -utilidadNeta, credito: 0n, nota: 'Pérdida del ejercicio' });
  return { lineas, utilidadNeta };
}
