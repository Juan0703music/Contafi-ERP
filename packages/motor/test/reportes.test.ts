import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balanceGeneral, balancePrueba, estadoResultados, auxiliar, lineasCierreAnual, validarComprobante, type Comprobante, type Linea } from '../src/index.ts';
import { AUXILIARES, C, CUENTAS, D, comprobante, ctx, $ } from './ayudas.ts';

/** Genera comprobantes balanceados aleatorios sobre cuentas auxiliares reales del PUC. */
const arbComprobante = fc
  .record({
    dia: fc.integer({ min: 1, max: 28 }),
    mes: fc.integer({ min: 1, max: 12 }),
    anio: fc.constantFrom(2025, 2026),
    montos: fc.array(fc.bigInt({ min: 1n, max: 50_000_000_000n }), { minLength: 1, maxLength: 6 }),
    cuentas: fc.array(fc.constantFrom(...AUXILIARES.map((c) => c.codigo)), { minLength: 7, maxLength: 7 }),
    anulado: fc.boolean(),
  })
  .map(({ dia, mes, anio, montos, cuentas, anulado }) => {
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const total = montos.reduce((a, b) => a + b, 0n);
    const lineas: Linea[] = montos.map((m, i) => ({ cuenta: cuentas[i]!, terceroId: 'T1', debito: m, credito: 0n }));
    lineas.push({ cuenta: cuentas[6]!, terceroId: 'T2', debito: 0n, credito: total });
    // Algunos quedan en borrador: no deben afectar los reportes.
    return comprobante(fecha, lineas, { estado: anulado ? 'borrador' : 'contabilizado' });
  });

describe('propiedades del motor (fast-check)', () => {
  it('todo comprobante generado es válido para el motor', () => {
    fc.assert(fc.property(arbComprobante, (c) => validarComprobante(c, ctx()).length === 0), { numRuns: 300 });
  });

  it('regla 9: el balance de prueba siempre cuadra, en cualquier rango', () => {
    fc.assert(
      fc.property(fc.array(arbComprobante, { maxLength: 40 }), fc.integer({ min: 1, max: 12 }), (cs, mes) => {
        const desde = `2026-${String(mes).padStart(2, '0')}-01`;
        const bp = balancePrueba(CUENTAS, cs, { desde, hasta: '2026-12-31' });
        return bp.cuadra;
      }),
      { numRuns: 200 },
    );
  });

  it('regla 9: activo = pasivo + patrimonio + resultado, antes y después del cierre anual', () => {
    fc.assert(
      fc.property(fc.array(arbComprobante, { maxLength: 40 }), (cs) => {
        if (!balanceGeneral(cs, '2026-12-31').cuadra) return false;
        const { lineas } = lineasCierreAnual(cs, 2025);
        const conCierre = lineas.length >= 2
          ? [...cs, comprobante('2025-12-31', lineas, { origen: 'cierre_anual', tipo: 'CC' })]
          : cs;
        const bg = balanceGeneral(conCierre, '2025-12-31');
        return bg.cuadra && bg.resultadoDelEjercicio === 0n;
      }),
      { numRuns: 200 },
    );
  });
});

describe('reportes con casos concretos', () => {
  const cs: Comprobante[] = [
    comprobante('2026-01-02', [D('111005', '50000000', null), C('310505', '50000000', null)]),
    comprobante('2026-01-15', [D('143505', '10000000'), D('240810', '1900000'), C('220505', '11900000')]),
    comprobante('2026-02-10', [D('130505', '17850000', 'T7'), C('413595', '15000000', 'T7'), C('240805', '2850000', 'T7')]),
    comprobante('2026-02-10', [D('613595', '8000000'), C('143505', '8000000')]),
    comprobante('2026-02-20', [D('513530', '450000'), C('111005', '450000', null)]),
  ];

  it('estado de resultados', () => {
    const er = estadoResultados(cs, { desde: '2026-01-01', hasta: '2026-12-31' });
    expect(er.ingresosOperacionales).toBe($('15000000'));
    expect(er.costos).toBe($('8000000'));
    expect(er.utilidadBruta).toBe($('7000000'));
    expect(er.gastosOperacionales).toBe($('450000'));
    expect(er.utilidadNeta).toBe($('6550000'));
  });

  it('balance general', () => {
    const bg = balanceGeneral(cs, '2026-02-28');
    expect(bg.activo).toBe($('50000000') + $('2000000') + $('17850000') - $('450000')); // 240810 es clase 2
    expect(bg.resultadoDelEjercicio).toBe($('6550000'));
    expect(bg.cuadra).toBe(true);
  });

  it('balance de prueba por niveles con saldo inicial', () => {
    const bp = balancePrueba(CUENTAS, cs, { desde: '2026-02-01', hasta: '2026-02-28' }, { nivelMaximo: 1 });
    expect(bp.cuadra).toBe(true);
    const activo = bp.filas.find((f) => f.codigo === '1')!;
    expect(activo.saldoInicial).toBe($('60000000')); // bancos + inventario de enero; 240810 es clase 2
  });

  it('auxiliar por tercero', () => {
    const aux = auxiliar(cs, '1305', { terceroId: 'T7' });
    expect(aux.filas).toHaveLength(1);
    expect(aux.saldoFinal).toBe($('17850000'));
  });

  it('regla 10: cierre anual lleva la utilidad a 3605 y deja en cero las clases 4 a 7', () => {
    const { lineas, utilidadNeta } = lineasCierreAnual(cs, 2026);
    expect(utilidadNeta).toBe($('6550000'));
    expect(lineas.at(-1)).toMatchObject({ cuenta: '360505', credito: $('6550000') });
    const cierre = comprobante('2026-12-31', lineas, { origen: 'cierre_anual', tipo: 'CC' });
    expect(validarComprobante(cierre, ctx())).toEqual([]);
    const bp = balancePrueba(CUENTAS, [...cs, cierre], { desde: '2026-01-01', hasta: '2026-12-31' }, { nivelMaximo: 1 });
    for (const clase of ['4', '5', '6']) expect(bp.filas.find((f) => f.codigo === clase)?.saldoFinal).toBe(0n);
    // El estado de resultados del año no se afecta por el comprobante de cierre.
    expect(estadoResultados([...cs, cierre], { desde: '2026-01-01', hasta: '2026-12-31' }).utilidadNeta).toBe($('6550000'));
  });
});
