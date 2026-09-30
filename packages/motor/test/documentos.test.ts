import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  asientoFacturaCompra, asientoFacturaVenta, asientoNotaCreditoVenta, asientoPago, asientoRecaudo,
  calcularTotales, validarComprobante, entrada, salida, costoPromedio, aMilesimas, INVENTARIO_VACIO,
  type ConceptoRetencion, type ParametrosAnuales, type ItemDocumento,
} from '../src/index.ts';
import { ctx, $ } from './ayudas.ts';

// VALORES DE EJEMPLO PARA PRUEBAS. Los reales vienen de parametros_anuales y deben verificarse cada año.
const P2026: ParametrosAnuales = { anio: 2026, uvt: $('52374') };

const RF_COMPRAS_PRACTICADA: ConceptoRetencion = { tipo: 'RETEFUENTE', codigo: 'RF-COMPRAS', nombre: 'Retención en la fuente compras', tarifa: 25_000n, baseMinimaUvt: '10', cuenta: '236540' };
const RIVA_PRACTICADA: ConceptoRetencion = { tipo: 'RETEIVA', codigo: 'RIVA-15', nombre: 'ReteIVA', tarifa: 150_000n, baseMinimaUvt: '10', cuenta: '236701' };
const RICA_PRACTICADA: ConceptoRetencion = { tipo: 'RETEICA', codigo: 'RICA-414', nombre: 'ReteICA', tarifa: 4_140n, baseMinimaUvt: '0', cuenta: '236801' };
const RF_QUE_NOS_PRACTICAN: ConceptoRetencion = { ...RF_COMPRAS_PRACTICADA, cuenta: '135515' };
const RIVA_QUE_NOS_PRACTICAN: ConceptoRetencion = { ...RIVA_PRACTICADA, cuenta: '135517' };

const valido = (lineas: ReturnType<typeof asientoFacturaVenta>) =>
  validarComprobante({ fecha: '2026-09-30', concepto: 'Documento', lineas }, ctx());

describe('factura de compra con retenciones', () => {
  const items: ItemDocumento[] = [
    { descripcion: 'Switch 24 puertos', cantidad: '2', valorUnitario: $('1000000'), iva: { tipo: 'gravado', tarifa: 190_000n }, cuenta: '143505' },
  ];

  it('calcula IVA, retefuente, reteIVA y reteICA', () => {
    const t = calcularTotales(items, [RF_COMPRAS_PRACTICADA, RIVA_PRACTICADA, RICA_PRACTICADA], P2026);
    expect(t.subtotal).toBe($('2000000'));
    expect(t.totalIva).toBe($('380000'));
    expect(t.total).toBe($('2380000'));
    expect(t.retenciones.map((r) => [r.tipo, r.valor])).toEqual([
      ['RETEFUENTE', $('50000')], ['RETEIVA', $('57000')], ['RETEICA', $('8280')],
    ]);
    expect(t.neto).toBe($('2264720'));

    const lineas = asientoFacturaCompra(t, 'PROV1');
    expect(valido(lineas)).toEqual([]);
    expect(lineas.find((l) => l.cuenta === '220505')?.credito).toBe($('2264720'));
    expect(lineas.find((l) => l.cuenta === '240810')?.debito).toBe($('380000'));
  });

  it('no practica retención si la base no alcanza el mínimo en UVT', () => {
    const pequeña = calcularTotales([{ ...items[0]!, cantidad: '1', valorUnitario: $('500000') }], [RF_COMPRAS_PRACTICADA], P2026);
    // 10 UVT × 52.374 = 523.740 > 500.000
    expect(pequeña.retenciones).toEqual([]);
    expect(pequeña.neto).toBe($('595000'));
  });

  it('IVA como mayor valor del gasto (no responsable de IVA)', () => {
    const t = calcularTotales([
      { descripcion: 'Papelería', cantidad: '3', valorUnitario: $('33333.33'), iva: { tipo: 'gravado', tarifa: 190_000n }, cuenta: '519530' },
    ], [], P2026);
    const lineas = asientoFacturaCompra(t, 'PROV2', { ivaDescontable: false });
    expect(valido(lineas)).toEqual([]);
    expect(lineas.find((l) => l.cuenta === '519530')?.debito).toBe(t.total);
    expect(lineas.some((l) => l.cuenta === '240810')).toBe(false);
  });
});

describe('factura de venta', () => {
  it('mezcla IVA 19 %, 5 %, exento y excluido, con costo de ventas y retenciones que nos practican', () => {
    const t = calcularTotales([
      { descripcion: 'Router', cantidad: '1', valorUnitario: $('295000'), iva: { tipo: 'gravado', tarifa: 190_000n }, costo: $('180000') },
      { descripcion: 'Producto 5 %', cantidad: '2.5', valorUnitario: $('10000'), iva: { tipo: 'gravado', tarifa: 50_000n } },
      { descripcion: 'Exento', cantidad: '1', valorUnitario: $('100000'), iva: { tipo: 'exento' } },
      { descripcion: 'Excluido', cantidad: '1', valorUnitario: $('200000'), iva: { tipo: 'excluido' }, descuento: $('20000') },
    ], [RF_QUE_NOS_PRACTICAN, RIVA_QUE_NOS_PRACTICAN], P2026);
    expect(t.subtotal).toBe($('600000'));
    expect(t.totalIva).toBe($('56050') + $('1250'));
    const lineas = asientoFacturaVenta(t, 'CLI1');
    expect(valido(lineas)).toEqual([]);
    expect(lineas.find((l) => l.cuenta === '135515')?.debito).toBe($('15000'));
    expect(lineas.find((l) => l.cuenta === '613595')?.debito).toBe($('180000'));
    expect(lineas.filter((l) => l.cuenta === '240805')).toHaveLength(2);
  });

  it('la nota crédito invierte la venta usando devoluciones', () => {
    const t = calcularTotales([{ descripcion: 'Router', cantidad: '1', valorUnitario: $('100000'), iva: { tipo: 'gravado', tarifa: 190_000n } }], [], P2026);
    const lineas = asientoNotaCreditoVenta(t, 'CLI1');
    expect(valido(lineas)).toEqual([]);
    expect(lineas.find((l) => l.cuenta === '417505')?.debito).toBe($('100000'));
    expect(lineas.find((l) => l.cuenta === '130505')?.credito).toBe($('119000'));
  });

  it('recaudos y pagos', () => {
    expect(valido(asientoRecaudo($('119000'), 'CLI1', '111005'))).toEqual([]);
    expect(valido(asientoPago($('119000'), 'PROV1', '111005'))).toEqual([]);
  });
});

describe('propiedad: todo documento genera un asiento válido y balanceado', () => {
  const arbItem = fc.record({
    cantidad: fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 999 })).map(([e, d]) => `${e + 1}.${String(d).padStart(3, '0')}`),
    valorUnitario: fc.bigInt({ min: 1n, max: 2_000_000_000n }),
    iva: fc.constantFrom({ tipo: 'gravado' as const, tarifa: 190_000n }, { tipo: 'gravado' as const, tarifa: 50_000n }, { tipo: 'exento' as const }, { tipo: 'excluido' as const }),
  }).map((x): ItemDocumento => ({ descripcion: 'x', ...x }));
  const arbRet = fc.subarray([RF_COMPRAS_PRACTICADA, RIVA_PRACTICADA, RICA_PRACTICADA]);

  it('compras', () => {
    fc.assert(fc.property(fc.array(arbItem, { minLength: 1, maxLength: 8 }), arbRet, fc.boolean(), (items, rets, descontable) => {
      const t = calcularTotales(items, rets, P2026);
      return valido(asientoFacturaCompra(t, 'P', { ivaDescontable: descontable })).length === 0;
    }), { numRuns: 300 });
  });
  it('ventas', () => {
    const rets = fc.subarray([RF_QUE_NOS_PRACTICAN, RIVA_QUE_NOS_PRACTICAN]);
    fc.assert(fc.property(fc.array(arbItem, { minLength: 1, maxLength: 8 }), rets, (items, r) => {
      const t = calcularTotales(items, r, P2026);
      return valido(asientoFacturaVenta(t, 'C')).length === 0 && valido(asientoNotaCreditoVenta(t, 'C')).length === 0;
    }), { numRuns: 300 });
  });
});

describe('inventario por costo promedio ponderado', () => {
  it('promedia entradas y costea salidas', () => {
    let e = entrada(INVENTARIO_VACIO, aMilesimas('10'), $('1000000'));  // 10 × 100.000
    e = entrada(e, aMilesimas('5'), $('650000'));                       // 5 × 130.000
    expect(costoPromedio(e)).toBe($('110000'));
    const s = salida(e, aMilesimas('3'));
    expect(s.costo).toBe($('330000'));
    const todo = salida(s.estado, aMilesimas('12'));
    expect(todo.estado).toMatchObject({ cantidad: 0n, valor: 0n });
  });
  it('no permite existencia negativa salvo que se indique (ventas sin conexión)', () => {
    const e = entrada(INVENTARIO_VACIO, aMilesimas('1'), $('100'));
    expect(() => salida(e, aMilesimas('2'))).toThrow(/insuficiente/);
    const s = salida(e, aMilesimas('2'), { permitirNegativo: true });
    expect(s.quedoNegativo).toBe(true);
    expect(s.costo).toBe($('200'));
  });
  it('propiedad: lo que entra = lo que sale + lo que queda (sin perder centavos)', () => {
    const op = fc.oneof(
      fc.record({ t: fc.constant('in' as const), q: fc.integer({ min: 1, max: 100_000 }), v: fc.bigInt({ min: 0n, max: 10_000_000_00n }) }),
      fc.record({ t: fc.constant('out' as const), q: fc.integer({ min: 1, max: 100_000 }), v: fc.constant(0n) }),
    );
    fc.assert(fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
      let e = INVENTARIO_VACIO, entradas = 0n, costos = 0n;
      for (const o of ops) {
        if (o.t === 'in') { e = entrada(e, BigInt(o.q), o.v); entradas += o.v; }
        else if (BigInt(o.q) <= e.cantidad) { const s = salida(e, BigInt(o.q)); e = s.estado; costos += s.costo; }
      }
      return entradas === costos + e.valor && e.cantidad >= 0n && (e.cantidad > 0n || e.valor === 0n);
    }), { numRuns: 300 });
  });
});
