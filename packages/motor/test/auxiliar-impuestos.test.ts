import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  auxiliarImpuestos, asientoFacturaCompra, asientoFacturaVenta, asientoNotaCreditoVenta, balancePrueba, calcularTotales, crearReverso,
  type ConceptoRetencion, type ItemDocumento, type ParametrosAnuales,
} from '../src/index.ts';
import { $, CUENTAS, comprobante } from './ayudas.ts';

// VALORES DE EJEMPLO PARA PRUEBAS (no son tarifas reales verificadas).
const P: ParametrosAnuales = { anio: 2026, uvt: $('40000') };
const RF: ConceptoRetencion = { tipo: 'RETEFUENTE', codigo: 'RF', nombre: 'Retefuente compras', tarifa: 25_000n, baseMinimaUvt: '0', cuenta: '236540' };
const RF_NOS: ConceptoRetencion = { ...RF, cuenta: '135515' };
const item = (valor: string, tarifa = 190_000n): ItemDocumento => ({ descripcion: 'x', cantidad: '1', valorUnitario: $(valor), iva: { tipo: 'gravado', tarifa } });
const periodo = { desde: '2026-09-01', hasta: '2026-09-30' };

describe('auxiliar de impuestos por período', () => {
  const venta = comprobante('2026-09-05', asientoFacturaVenta(calcularTotales([item('1000000'), item('200000', 50_000n)], [RF_NOS], P), 'CLI'), { tipo: 'FV' });
  const compra = comprobante('2026-09-10', asientoFacturaCompra(calcularTotales([item('400000')], [RF], P), 'PROV'), { tipo: 'FC' });
  const nc = comprobante('2026-09-20', asientoNotaCreditoVenta(calcularTotales([item('100000')], [], P), 'CLI'), { tipo: 'NC' });
  const fueraDelPeriodo = comprobante('2026-10-01', asientoFacturaCompra(calcularTotales([item('999000')], [RF], P), 'PROV'));

  it('IVA generado, descontable y saldo; retenciones con base y por tercero', () => {
    const a = auxiliarImpuestos(CUENTAS, [venta, compra, nc, fueraDelPeriodo], periodo);
    // Generado: 190.000 + 10.000 − 19.000 (nota crédito) · Descontable: 76.000
    expect(a.iva).toEqual({ generado: $('181000'), descontable: $('76000'), saldo: $('105000') });
    expect(a.grupos.map((g) => [g.prefijo, g.valor])).toEqual([['2408', $('105000')], ['2365', $('10000')], ['1355', $('30000')]]);
    const iva = a.grupos[0]!.cuentas.find((c) => c.cuenta === '240805')!;
    expect(iva.base).toBe($('1100000')); // 1.000.000 + 200.000 − 100.000 de la nota crédito
    const rf = a.grupos[1]!.cuentas[0]!;
    expect(rf).toMatchObject({ cuenta: '236540', base: $('400000'), valor: $('10000'), porTercero: [{ terceroId: 'PROV', base: $('400000'), valor: $('10000') }] });
    expect(rf.movimientos).toHaveLength(1); // la compra de octubre no entra
  });

  it('un comprobante anulado y su reverso se compensan', () => {
    const reverso = { ...crearReverso(compra, { id: 'r1', fecha: '2026-09-15', motivo: 'Error' }), estado: 'contabilizado' as const, numero: 'FC-R' };
    const a = auxiliarImpuestos(CUENTAS, [{ ...compra, estado: 'anulado' }, reverso], periodo);
    expect(a.iva.descontable).toBe(0n);
    const rf = a.grupos.find((g) => g.prefijo === '2365')!.cuentas[0]!;
    expect([rf.valor, rf.base, rf.movimientos.length]).toEqual([0n, 0n, 2]);
    expect(rf.porTercero).toEqual([]);
  });

  it('propiedad: el valor de cada cuenta coincide con el movimiento del balance de prueba', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 50_000_000 }), fc.boolean()), { minLength: 1, maxLength: 12 }), (docs) => {
      const cs = docs.map(([v, esVenta], i) => {
        const t = calcularTotales([item(String(v))], [esVenta ? RF_NOS : RF], P);
        return comprobante(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, esVenta ? asientoFacturaVenta(t, 'A') : asientoFacturaCompra(t, 'B'));
      });
      const a = auxiliarImpuestos(CUENTAS, cs, periodo);
      const bp = balancePrueba(CUENTAS, cs, periodo);
      for (const g of a.grupos) for (const c of g.cuentas) {
        const f = bp.filas.find((x) => x.codigo === c.cuenta)!;
        expect(c.debitos).toBe(f.debitos);
        expect(c.creditos).toBe(f.creditos);
      }
    }));
  });
});
