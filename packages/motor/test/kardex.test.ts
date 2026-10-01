import { describe, expect, it } from 'vitest';
import {
  asientoFacturaCompra, asientoFacturaVenta, calcularTotales, crearReverso, kardex, aMilesimas, validarComprobante,
  type ItemDocumento,
} from '../src/index.ts';
import { comprobante, ctx, $ } from './ayudas.ts';

const P = { anio: 2026, uvt: $('52374') };
const producto = (id: string, cantidad: string, valor: string, costo?: string): ItemDocumento => ({
  descripcion: id, cantidad, valorUnitario: $(valor), iva: { tipo: 'gravado', tarifa: 190_000n }, productoId: id, ...(costo ? { costo: $(costo) } : {}),
});

describe('inventario en los asientos', () => {
  it('la compra de productos va a inventario con producto y cantidad, sin mezclar productos', () => {
    const t = calcularTotales([producto('ROUTER', '10', '100000'), producto('SWITCH', '2', '700000')], [], P);
    const lineas = asientoFacturaCompra(t, 'PROV');
    expect(validarComprobante({ fecha: '2026-09-01', concepto: 'Compra', lineas }, ctx())).toEqual([]);
    expect(lineas.filter((l) => l.cuenta === '143505').map((l) => [l.productoId, l.cantidad, l.debito])).toEqual([
      ['ROUTER', 10_000n, $('1000000')], ['SWITCH', 2_000n, $('1400000')],
    ]);
  });

  it('la venta registra el costo y la salida con producto y cantidad', () => {
    const t = calcularTotales([producto('ROUTER', '3', '200000', '330000')], [], P);
    const lineas = asientoFacturaVenta(t, 'CLI');
    expect(validarComprobante({ fecha: '2026-09-05', concepto: 'Venta', lineas }, ctx())).toEqual([]);
    expect(lineas.find((l) => l.cuenta === '143505')).toMatchObject({ productoId: 'ROUTER', cantidad: 3_000n, credito: $('330000') });
    expect(lineas.find((l) => l.cuenta === '613595')?.debito).toBe($('330000'));
  });
});

describe('kárdex derivado de los comprobantes', () => {
  const compra1 = comprobante('2026-09-01', asientoFacturaCompra(calcularTotales([producto('R', '10', '100000')], [], P), 'P'));
  const compra2 = comprobante('2026-09-03', asientoFacturaCompra(calcularTotales([producto('R', '5', '130000')], [], P), 'P'));
  const venta = comprobante('2026-09-05', asientoFacturaVenta(calcularTotales([producto('R', '3', '200000', '330000')], [], P), 'C'));

  it('costo promedio, saldos y movimientos en orden', () => {
    const k = kardex([venta, compra2, compra1], 'R');
    expect(k.movimientos.map((m) => [m.tipo, m.cantidad, m.valor, m.saldoCantidad, m.saldoValor, m.costoPromedio])).toEqual([
      ['entrada', aMilesimas('10'), $('1000000'), aMilesimas('10'), $('1000000'), $('100000')],
      ['entrada', aMilesimas('5'), $('650000'), aMilesimas('15'), $('1650000'), $('110000')],
      ['salida', aMilesimas('3'), $('330000'), aMilesimas('12'), $('1320000'), $('110000')],
    ]);
    expect(kardex([compra1], 'OTRO').movimientos).toEqual([]);
  });

  it('anular la venta devuelve las unidades al kárdex', () => {
    const reverso = { ...crearReverso(venta, { id: 'rv', fecha: '2026-09-06', motivo: 'Devolución' }), estado: 'contabilizado' as const, numero: 'CG-9' };
    const k = kardex([compra1, compra2, { ...venta, estado: 'anulado' as const }, reverso], 'R');
    expect(k.estado).toMatchObject({ cantidad: aMilesimas('15'), valor: $('1650000') });
  });

  it('los borradores no afectan el kárdex', () => {
    expect(kardex([compra1, { ...venta, estado: 'borrador' }], 'R').estado.cantidad).toBe(aMilesimas('10'));
  });
});
