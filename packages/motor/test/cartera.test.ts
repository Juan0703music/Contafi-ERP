import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { antiguedadSaldos, auxiliar } from '../src/index.ts';
import { C, D, comprobante, $ } from './ayudas.ts';

describe('cartera por edades (PEPS)', () => {
  const cs = [
    comprobante('2026-05-01', [D('130505', '1000', 'A'), C('413595', '1000')]),
    comprobante('2026-07-15', [D('130505', '500', 'A'), C('413595', '500')]),
    comprobante('2026-08-01', [D('111005', '600', null), C('130505', '600', 'A')]), // abona lo más antiguo
    comprobante('2026-09-20', [D('130505', '300', 'B'), C('413595', '300')]),
    comprobante('2026-09-25', [D('111005', '400', null), C('130505', '400', 'B')]), // B pagó de más: anticipo
  ];

  it('distribuye lo pendiente por días y descuenta abonos de lo más antiguo', () => {
    const r = antiguedadSaldos(cs, '1305', 'D', '2026-09-30');
    const a = r.find((x) => x.terceroId === 'A')!;
    expect(a.saldo).toBe($('900'));
    expect(a.partidas.map((p) => [p.fecha, p.pendiente, p.dias])).toEqual([['2026-05-01', $('400'), 152], ['2026-07-15', $('500'), 77]]);
    expect(a.rangos).toEqual({ r0_30: 0n, r31_60: 0n, r61_90: $('500'), mas90: $('400') });
    const b = r.find((x) => x.terceroId === 'B')!;
    expect(b.saldo).toBe(-$('100')); // anticipo del cliente
    expect(b.partidas).toEqual([]);
  });

  it('cuentas por pagar (naturaleza crédito)', () => {
    const r = antiguedadSaldos([comprobante('2026-09-01', [D('519595', '250'), C('220505', '250', 'P')])], '2205', 'C', '2026-09-30');
    expect(r[0]).toMatchObject({ terceroId: 'P', saldo: $('250'), rangos: { r0_30: $('250') } });
  });

  it('propiedad: el saldo por edades de cada tercero es igual al saldo del auxiliar', () => {
    const mov = fc.record({ dia: fc.integer({ min: 1, max: 28 }), mes: fc.integer({ min: 1, max: 9 }), t: fc.constantFrom('A', 'B', 'C'), v: fc.bigInt({ min: 1n, max: 9_999_999n }), cargo: fc.boolean() });
    fc.assert(fc.property(fc.array(mov, { maxLength: 40 }), (ms) => {
      const lista = ms.map((m) => {
        const f = `2026-${String(m.mes).padStart(2, '0')}-${String(m.dia).padStart(2, '0')}`;
        const v = (m.v).toString();
        return m.cargo
          ? comprobante(f, [{ cuenta: '130505', terceroId: m.t, debito: BigInt(v), credito: 0n }, { cuenta: '413595', debito: 0n, credito: BigInt(v) }])
          : comprobante(f, [{ cuenta: '111005', debito: BigInt(v), credito: 0n }, { cuenta: '130505', terceroId: m.t, debito: 0n, credito: BigInt(v) }]);
      });
      const r = antiguedadSaldos(lista, '1305', 'D', '2026-09-30');
      return ['A', 'B', 'C'].every((t) => {
        const esperado = auxiliar(lista, '1305', { terceroId: t, hasta: '2026-09-30' }).saldoFinal;
        const obtenido = r.find((x) => x.terceroId === t)?.saldo ?? 0n;
        const rangos = r.find((x) => x.terceroId === t)?.rangos;
        const suma = rangos ? rangos.r0_30 + rangos.r31_60 + rangos.r61_90 + rangos.mas90 : 0n;
        return obtenido === esperado && (esperado < 0n || suma === esperado);
      });
    }), { numRuns: 300 });
  });
});
