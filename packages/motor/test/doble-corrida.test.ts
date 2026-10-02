import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compararBalance, crearReverso } from '../src/index.ts';
import { $, C, CUENTAS, D, comprobante } from './ayudas.ts';

const libros = [
  comprobante('2026-01-02', [D('111005', '50000000'), D('110505', '5000000'), C('310505', '55000000')]),
  comprobante('2026-02-10', [D('130505', '1190000'), C('413595', '1000000'), C('240805', '190000')]),
  comprobante('2026-03-15', [D('519595', '200000'), C('111005', '200000')]),
];

describe('doble corrida: comparar con el balance del software anterior', () => {
  it('cero diferencias a cualquier nivel del PUC (el otro software trae 1105 y 11 a la vez)', () => {
    const r = compararBalance(CUENTAS, libros, '2026-03-31', [
      { cuenta: '11', saldo: $('54800000') }, { cuenta: '1105', saldo: $('5000000') }, { cuenta: '111005', saldo: $('49800000') },
      { cuenta: '130505', saldo: $('1190000') }, { cuenta: '240805', saldo: -$('190000') }, { cuenta: '31', saldo: -$('55000000') },
      { cuenta: '4135', saldo: -$('1000000') }, { cuenta: '5195', saldo: $('200000') },
    ]);
    expect(r.diferencias).toEqual([]);
    expect(r.soloContafi).toEqual([]);
    expect(r.sinDiferencias).toBe(true);
    expect(r.filas.find((f) => f.cuenta === '1105')).toMatchObject({ nombre: 'Caja', contafi: $('5000000') });
  });

  it('muestra cada diferencia, lo que solo tiene Contafi y respeta el corte', () => {
    const r = compararBalance(CUENTAS, libros, '2026-02-28', [
      { cuenta: '111005', saldo: $('50000000') }, { cuenta: '110505', saldo: $('5000000') },
      { cuenta: '130505', saldo: $('1100000') }, { cuenta: '310505', saldo: -$('55000000') }, { cuenta: '999999', nombre: 'Cuenta rara', saldo: $('1') },
    ]);
    expect(r.diferencias.map((d) => [d.cuenta, d.diferencia])).toEqual([['130505', $('90000')], ['999999', -$('1')]]);
    expect(r.diferencias[1]).toMatchObject({ nombre: 'Cuenta rara', contafi: 0n });
    expect(r.soloContafi.map((x) => [x.cuenta, x.saldo])).toEqual([['240805', -$('190000')], ['413595', -$('1000000')]]);
    expect(r.sinDiferencias).toBe(false);
  });

  it('una anulación no deja diferencias; el mismo código repetido (por tercero) se suma', () => {
    const anulado = { ...libros[2]!, estado: 'anulado' as const };
    const reverso = { ...crearReverso(libros[2]!, { id: 'r', fecha: '2026-03-20', motivo: 'Error' }), estado: 'contabilizado' as const, numero: 'CG-R' };
    const r = compararBalance(CUENTAS, [libros[0]!, anulado, reverso], '2026-03-31', [
      { cuenta: '111005', saldo: $('30000000') }, { cuenta: '111005', saldo: $('20000000') }, { cuenta: '110505', saldo: $('5000000') }, { cuenta: '3', saldo: -$('55000000') },
    ]);
    expect(r.sinDiferencias).toBe(true);
  });

  it('propiedad: comparar los libros contra sus propios saldos siempre da cero diferencias', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 9_000_000 }), { minLength: 1, maxLength: 10 }), (valores) => {
      const cs = valores.map((v, i) => comprobante(`2026-0${(i % 9) + 1}-10`, [D('519595', String(v)), C('111005', String(v))]));
      const externas = [{ cuenta: '5195', saldo: valores.reduce((s, v) => s + $(String(v)), 0n) }, { cuenta: '1110', saldo: -valores.reduce((s, v) => s + $(String(v)), 0n) }];
      expect(compararBalance(CUENTAS, cs, '2026-12-31', externas).sinDiferencias).toBe(true);
    }));
  });
});
