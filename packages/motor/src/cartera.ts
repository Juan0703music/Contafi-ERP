import { diasEntre, type Centavos, type FechaISO } from '@contafi/shared';
import { EN_LIBROS, type Comprobante } from './tipos.ts';

export interface PartidaAbierta {
  comprobanteId: string;
  numero: string | null;
  fecha: FechaISO;
  pendiente: Centavos;
  dias: number;
}

export interface AntiguedadTercero {
  terceroId: string;
  saldo: Centavos;
  rangos: { r0_30: Centavos; r31_60: Centavos; r61_90: Centavos; mas90: Centavos };
  partidas: PartidaAbierta[];
}

/**
 * Antigüedad de saldos por tercero (cartera por edades o cuentas por pagar). Sin vencimientos por
 * documento, cada cargo se toma como una partida y los abonos cancelan primero las más antiguas (PEPS).
 * `lado`: 'D' para cuentas de naturaleza débito (clientes, 1305), 'C' para crédito (proveedores, 2205).
 */
export function antiguedadSaldos(
  comprobantes: readonly Comprobante[], prefijoCuenta: string, lado: 'D' | 'C', corte: FechaISO,
): AntiguedadTercero[] {
  const porTercero = new Map<string, { fecha: FechaISO; id: string; numero: string | null; cargo: bigint; abono: bigint }[]>();
  for (const c of comprobantes) {
    if (!EN_LIBROS.has(c.estado) || c.fecha > corte) continue;
    for (const l of c.lineas) {
      if (!l.cuenta.startsWith(prefijoCuenta) || !l.terceroId) continue;
      const cargo = lado === 'D' ? l.debito : l.credito;
      const abono = lado === 'D' ? l.credito : l.debito;
      const lista = porTercero.get(l.terceroId) ?? [];
      lista.push({ fecha: c.fecha, id: c.id, numero: c.numero, cargo, abono });
      porTercero.set(l.terceroId, lista);
    }
  }
  const resultado: AntiguedadTercero[] = [];
  for (const [terceroId, movs] of porTercero) {
    movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.numero ?? '').localeCompare(b.numero ?? ''));
    const abiertas: { fecha: FechaISO; id: string; numero: string | null; pendiente: bigint }[] = [];
    let saldoAFavor = 0n; // abonos que exceden los cargos (anticipos)
    for (const m of movs) {
      if (m.cargo > 0n) {
        let pendiente = m.cargo;
        const usado = saldoAFavor < pendiente ? saldoAFavor : pendiente;
        saldoAFavor -= usado;
        pendiente -= usado;
        if (pendiente > 0n) abiertas.push({ fecha: m.fecha, id: m.id, numero: m.numero, pendiente });
      }
      let abono = m.abono;
      while (abono > 0n && abiertas.length) {
        const p = abiertas[0]!;
        const usado = abono < p.pendiente ? abono : p.pendiente;
        p.pendiente -= usado;
        abono -= usado;
        if (p.pendiente === 0n) abiertas.shift();
      }
      saldoAFavor += abono;
    }
    const rangos = { r0_30: 0n, r31_60: 0n, r61_90: 0n, mas90: 0n };
    const partidas = abiertas.map((p) => {
      const dias = diasEntre(p.fecha, corte);
      if (dias <= 30) rangos.r0_30 += p.pendiente;
      else if (dias <= 60) rangos.r31_60 += p.pendiente;
      else if (dias <= 90) rangos.r61_90 += p.pendiente;
      else rangos.mas90 += p.pendiente;
      return { comprobanteId: p.id, numero: p.numero, fecha: p.fecha, pendiente: p.pendiente, dias };
    });
    const saldo = partidas.reduce((s, p) => s + p.pendiente, 0n) - saldoAFavor;
    if (saldo !== 0n || partidas.length) resultado.push({ terceroId, saldo, rangos, partidas });
  }
  return resultado.sort((a, b) => (b.saldo > a.saldo ? 1 : b.saldo < a.saldo ? -1 : 0));
}
