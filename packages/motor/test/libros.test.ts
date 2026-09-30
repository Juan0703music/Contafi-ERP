import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  libroDiario, libroMayor, estadoSituacionFinanciera, estadoResultadosDetallado, estadoResultados, balanceGeneral,
  lineasCierreAnual, type Linea,
} from '../src/index.ts';
import { AUXILIARES, C, CUENTAS, D, comprobante, $ } from './ayudas.ts';

const cs = [
  comprobante('2026-01-02', [D('111005', '50000000', null), C('310505', '50000000', null)]),
  comprobante('2026-01-15', [D('143505', '10000000'), D('240810', '1900000'), C('220505', '11900000')]),
  comprobante('2026-02-10', [D('130505', '17850000', 'T7'), C('413595', '15000000', 'T7'), C('240805', '2850000', 'T7')]),
  comprobante('2026-02-10', [D('613595', '8000000'), C('143505', '8000000')]),
  comprobante('2026-02-20', [D('513530', '450000'), C('111005', '450000', null)]),
  comprobante('2026-02-21', [D('152805', '3000000'), C('111005', '3000000', null)]),
  comprobante('2026-02-25', [D('519595', '1'), C('111005', '1', null)], { estado: 'borrador' }),
];

describe('libro diario', () => {
  it('lista en orden cronológico solo lo contabilizado, con totales iguales', () => {
    const d = libroDiario(CUENTAS, [...cs].reverse(), { desde: '2026-02-01', hasta: '2026-02-28' });
    expect(d.asientos.map((a) => a.fecha)).toEqual(['2026-02-10', '2026-02-10', '2026-02-20', '2026-02-21']);
    expect(d.totalDebitos).toBe(d.totalCreditos);
    expect(d.asientos[0]!.lineas[0]!.nombreCuenta).toBe('Clientes nacionales');
  });
});

describe('libro mayor y balances', () => {
  it('trae solo cuentas de mayor (4 dígitos) con saldo inicial y final', () => {
    const m = libroMayor(CUENTAS, cs, { desde: '2026-02-01', hasta: '2026-02-28' });
    expect(m.filas.every((f) => f.codigo.length === 4)).toBe(true);
    expect(m.cuadra).toBe(true);
    const bancos = m.filas.find((f) => f.codigo === '1110')!;
    expect(bancos.saldoInicial).toBe($('50000000'));
    expect(bancos.saldoFinal).toBe($('50000000') - $('3450000'));
  });
});

describe('estados financieros', () => {
  it('estado de situación financiera clasificado y cuadrado', () => {
    const esf = estadoSituacionFinanciera(CUENTAS, cs, '2026-02-28');
    expect(esf.activoCorriente.renglones.map((r) => r.codigo)).toEqual(['11', '13', '14']);
    expect(esf.activoNoCorriente.renglones.map((r) => [r.codigo, r.valor])).toEqual([['15', $('3000000')]]);
    expect(esf.pasivoCorriente.total).toBe($('11900000') + $('2850000') - $('1900000'));
    expect(esf.patrimonio.renglones.at(-1)).toMatchObject({ nombre: 'Utilidad del ejercicio (sin cerrar)', valor: $('6550000') });
    expect(esf.cuadra).toBe(true);
    expect(esf.totalActivo).toBe(balanceGeneral(cs, '2026-02-28').activo);
  });

  it('estado de resultados por cuentas de mayor', () => {
    const er = estadoResultadosDetallado(CUENTAS, cs, { desde: '2026-01-01', hasta: '2026-12-31' });
    expect(er.secciones[0]).toMatchObject({ titulo: 'Ingresos operacionales', total: $('15000000'), renglones: [{ codigo: '4135', valor: $('15000000') }] });
    expect(er.utilidadBruta).toBe($('7000000'));
    expect(er.utilidadNeta).toBe($('6550000'));
  });

  const arb = fc.array(fc.record({
    mes: fc.integer({ min: 1, max: 12 }),
    montos: fc.array(fc.bigInt({ min: 1n, max: 9_000_000_000n }), { minLength: 1, maxLength: 4 }),
    cuentas: fc.array(fc.constantFrom(...AUXILIARES.map((c) => c.codigo)), { minLength: 5, maxLength: 5 }),
  }).map(({ mes, montos, cuentas }) => {
    const total = montos.reduce((a, b) => a + b, 0n);
    const lineas: Linea[] = montos.map((m, i) => ({ cuenta: cuentas[i]!, terceroId: 'T', debito: m, credito: 0n }));
    lineas.push({ cuenta: cuentas[4]!, terceroId: 'T', debito: 0n, credito: total });
    return comprobante(`2026-${String(mes).padStart(2, '0')}-15`, lineas);
  }), { maxLength: 30 });

  it('propiedad: el estado de situación financiera siempre cuadra y coincide con el balance general, antes y después del cierre', () => {
    fc.assert(fc.property(arb, (lista) => {
      const esf = estadoSituacionFinanciera(CUENTAS, lista, '2026-12-31');
      const bg = balanceGeneral(lista, '2026-12-31');
      if (!esf.cuadra || esf.totalActivo !== bg.activo || esf.totalPasivo !== bg.pasivo) return false;
      const { lineas } = lineasCierreAnual(lista, 2026);
      const cerrado = lineas.length >= 2 ? [...lista, comprobante('2026-12-31', lineas, { origen: 'cierre_anual' })] : lista;
      const despues = estadoSituacionFinanciera(CUENTAS, cerrado, '2026-12-31');
      return despues.cuadra && !despues.patrimonio.renglones.some((r) => r.nombre.includes('sin cerrar'));
    }), { numRuns: 200 });
  });

  it('propiedad: la utilidad del estado detallado es la misma del estado de resultados', () => {
    fc.assert(fc.property(arb, (lista) => {
      const rango = { desde: '2026-01-01', hasta: '2026-12-31' };
      return estadoResultadosDetallado(CUENTAS, lista, rango).utilidadNeta === estadoResultados(lista, rango).utilidadNeta;
    }), { numRuns: 200 });
  });
});
