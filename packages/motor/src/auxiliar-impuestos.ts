import { CUENTAS_POR_DEFECTO, type Centavos, type FechaISO } from '@contafi/shared';
import { EN_LIBROS, type Comprobante, type Cuenta } from './tipos.ts';

/**
 * Auxiliar de impuestos por período (sección 11.1): IVA y retenciones con su base, comprobante y tercero,
 * para preparar las declaraciones y los certificados de retención. Toma solo lo que está en libros.
 */
export const GRUPOS_IMPUESTOS = [
  { prefijo: '2408', nombre: 'IVA por pagar (generado y descontable)' },
  { prefijo: '2365', nombre: 'Retención en la fuente por pagar' },
  { prefijo: '2367', nombre: 'IVA retenido por pagar (reteIVA)' },
  { prefijo: '2368', nombre: 'ICA retenido por pagar (reteICA)' },
  { prefijo: '1355', nombre: 'Retenciones que le practicaron a la empresa (anticipo de impuestos)' },
] as const;

export interface MovimientoImpuesto {
  comprobanteId: string;
  numero: string | null;
  fecha: FechaISO;
  concepto: string;
  nota: string | null;
  terceroId: string | null;
  base: Centavos | null;
  debito: Centavos;
  credito: Centavos;
}

export interface CuentaImpuesto {
  cuenta: string;
  nombre: string;
  naturaleza: 'D' | 'C';
  movimientos: MovimientoImpuesto[];
  base: Centavos;
  debitos: Centavos;
  creditos: Centavos;
  /** Según la naturaleza: créditos − débitos para las cuentas por pagar; débitos − créditos para 1355. */
  valor: Centavos;
  /** Para certificados de retención: base y valor por tercero. */
  porTercero: { terceroId: string | null; base: Centavos; valor: Centavos }[];
}

export interface AuxiliarImpuestos {
  grupos: { prefijo: string; nombre: string; cuentas: CuentaImpuesto[]; valor: Centavos }[];
  /** IVA del período: generado − descontable = saldo a pagar (negativo: saldo a favor). */
  iva: { generado: Centavos; descontable: Centavos; saldo: Centavos };
}

export function auxiliarImpuestos(
  cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], periodo: { desde: FechaISO; hasta: FechaISO },
  cuentasIva: { generado: string; descontable: string } = { generado: CUENTAS_POR_DEFECTO.ivaGenerado, descontable: CUENTAS_POR_DEFECTO.ivaDescontable },
): AuxiliarImpuestos {
  const plan = new Map([...cuentas].map((c) => [c.codigo, c]));
  const porCuenta = new Map<string, CuentaImpuesto>();
  const ordenados = [...comprobantes]
    .filter((c) => EN_LIBROS.has(c.estado) && c.fecha >= periodo.desde && c.fecha <= periodo.hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.numero ?? '').localeCompare(b.numero ?? ''));
  for (const c of ordenados) {
    for (const l of c.lineas) {
      if (!GRUPOS_IMPUESTOS.some((g) => l.cuenta.startsWith(g.prefijo))) continue;
      let ci = porCuenta.get(l.cuenta);
      if (!ci) {
        const p = plan.get(l.cuenta);
        ci = { cuenta: l.cuenta, nombre: p?.nombre ?? l.cuenta, naturaleza: p?.naturaleza ?? (l.cuenta.startsWith('1') ? 'D' : 'C'),
          movimientos: [], base: 0n, debitos: 0n, creditos: 0n, valor: 0n, porTercero: [] };
        porCuenta.set(l.cuenta, ci);
      }
      ci.movimientos.push({ comprobanteId: c.id, numero: c.numero, fecha: c.fecha, concepto: c.concepto, nota: l.nota ?? null,
        terceroId: l.terceroId ?? null, base: l.base ?? null, debito: l.debito, credito: l.credito });
    }
  }
  for (const ci of porCuenta.values()) {
    const terceros = new Map<string | null, { terceroId: string | null; base: Centavos; valor: Centavos }>();
    for (const m of ci.movimientos) {
      const signo = ci.naturaleza === 'C' ? m.credito - m.debito : m.debito - m.credito;
      // La base sigue el signo del movimiento: una nota crédito o una anulación resta base.
      const base = m.base == null ? 0n : (signo < 0n ? -m.base : m.base);
      ci.debitos += m.debito;
      ci.creditos += m.credito;
      ci.base += base;
      const t = terceros.get(m.terceroId) ?? { terceroId: m.terceroId, base: 0n, valor: 0n };
      t.base += base;
      t.valor += signo;
      terceros.set(m.terceroId, t);
    }
    ci.valor = ci.naturaleza === 'C' ? ci.creditos - ci.debitos : ci.debitos - ci.creditos;
    ci.porTercero = [...terceros.values()].filter((t) => t.valor !== 0n || t.base !== 0n).sort((a, b) => (b.valor > a.valor ? 1 : b.valor < a.valor ? -1 : 0));
  }
  const grupos = GRUPOS_IMPUESTOS.map((g) => {
    const lista = [...porCuenta.values()].filter((c) => c.cuenta.startsWith(g.prefijo)).sort((a, b) => a.cuenta.localeCompare(b.cuenta));
    // El total del grupo usa la naturaleza del grupo (2408 es pasivo aunque el IVA descontable sea débito).
    const pasivo = g.prefijo.startsWith('2');
    return { prefijo: g.prefijo, nombre: g.nombre, cuentas: lista,
      valor: lista.reduce((s, c) => s + (pasivo ? c.creditos - c.debitos : c.debitos - c.creditos), 0n) };
  }).filter((g) => g.cuentas.length > 0);
  const neto = (prefijo: string, lado: 'C' | 'D') => [...porCuenta.values()].filter((c) => c.cuenta.startsWith(prefijo))
    .reduce((s, c) => s + (lado === 'C' ? c.creditos - c.debitos : c.debitos - c.creditos), 0n);
  const generado = neto(cuentasIva.generado, 'C');
  const descontable = neto(cuentasIva.descontable, 'D');
  return { grupos, iva: { generado, descontable, saldo: generado - descontable } };
}
