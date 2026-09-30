import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sugerirConciliacion, resumenConciliacion, type MovimientoBanco, type MovimientoLibro } from '../src/index.ts';
import { $ } from './ayudas.ts';

const b = (id: string, fecha: string, v: string): MovimientoBanco => ({ id, fecha, descripcion: id, valor: $(v) });
const l = (id: string, fecha: string, v: string): MovimientoLibro => ({ id, fecha, concepto: id, valor: $(v) });

describe('conciliación bancaria asistida', () => {
  it('empareja por valor y fecha más cercana, uno a uno', () => {
    const banco = [b('B1', '2026-09-03', '1000'), b('B2', '2026-09-04', '1000'), b('B3', '2026-09-10', '-250'), b('B4', '2026-09-30', '-12.5')];
    const libros = [l('L1', '2026-09-01', '1000'), l('L2', '2026-09-04', '1000'), l('L3', '2026-09-09', '-250'), l('L4', '2026-08-01', '-250')];
    expect(sugerirConciliacion(banco, libros)).toEqual([
      { banco: 'B1', libro: 'L1', diasDiferencia: 2 },
      { banco: 'B2', libro: 'L2', diasDiferencia: 0 },
      { banco: 'B3', libro: 'L3', diasDiferencia: 1 },
    ]); // B4 (cargo bancario) y L4 (fuera de la tolerancia) quedan pendientes
  });

  it('respeta lo ya conciliado', () => {
    const r = sugerirConciliacion([b('B1', '2026-09-03', '1000')], [l('L1', '2026-09-03', '1000')], { yaConciliadosLibro: new Set(['L1']) });
    expect(r).toEqual([]);
  });

  it('resumen: con las partidas pendientes, la diferencia es cero', () => {
    // Libros: 10.000 (incluye un cheque de 1.000 no cobrado). Extracto: 10.988 (cobró 12 de comisión y no el cheque)
    const r = resumenConciliacion($('10000'), $('10988'), [b('comision', '2026-09-30', '-12')], [l('cheque', '2026-09-28', '-1000')]);
    expect(r).toMatchObject({ bancoSinRegistrar: -$('12'), librosEnTransito: -$('1000'), diferencia: 0n });
  });

  it('propiedad: nunca usa un movimiento dos veces y solo empareja valores iguales dentro de la tolerancia', () => {
    const mov = fc.record({ dia: fc.integer({ min: 1, max: 28 }), valor: fc.constantFrom('100', '-100', '250', '-40', '1000') });
    fc.assert(fc.property(fc.array(mov, { maxLength: 25 }), fc.array(mov, { maxLength: 25 }), (xs, ys) => {
      const banco = xs.map((x, i) => b(`B${i}`, `2026-09-${String(x.dia).padStart(2, '0')}`, x.valor));
      const libros = ys.map((y, i) => l(`L${i}`, `2026-09-${String(y.dia).padStart(2, '0')}`, y.valor));
      const p = sugerirConciliacion(banco, libros, { toleranciaDias: 3 });
      const unicos = new Set(p.map((x) => x.banco)).size === p.length && new Set(p.map((x) => x.libro)).size === p.length;
      const validos = p.every((x) => {
        const bb = banco.find((m) => m.id === x.banco)!;
        const ll = libros.find((m) => m.id === x.libro)!;
        return bb.valor === ll.valor && x.diasDiferencia <= 3;
      });
      return unicos && validos;
    }), { numRuns: 300 });
  });
});
