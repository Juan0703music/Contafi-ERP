import { describe, expect, it } from 'vitest';
import { aCentavos as $, PUC_SEMILLA, aceptaMovimientoEnPlantilla, nivelPuc } from '@contafi/shared';
import {
  migrar, guardarEmpresas, crearTercero, guardarConcepto, guardarUvt, crearFactura, calcularFactura,
  registrarMovimientoTercero, antiguedadLocal, leerComprobantes, ErrorLocal, s,
} from '../src/index.ts';
import { baseNode } from './ayudas.ts';

const E = 'e1';

async function empresa() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: E, firma_id: 'f', nit: '900123456', dv: 8, razon_social: 'Andina' }]);
  await base.lote([
    ...PUC_SEMILLA.map((c) => s(`insert into cuentas values (?, ?, ?, ?, ?, ?, ?, 0, 1)`, E, c.codigo, c.nombre, c.naturaleza, nivelPuc(c.codigo), aceptaMovimientoEnPlantilla(c.codigo), c.exigeTercero)),
    ...['FV', 'FC', 'RC', 'CE'].map((t) => s('insert into tipos_comprobante values (?, ?, ?, ?)', E, t, t, t)),
  ]);
  const cliente = await crearTercero(base, E, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'El Roble', tipos: ['cliente'] });
  const proveedor = await crearTercero(base, E, { tipo_doc: '31', numero: '901223556', dv: 9, nombre: 'Suministros del Norte', tipos: ['proveedor'] });
  // VALORES DE EJEMPLO para la prueba
  await guardarConcepto(base, E, { codigo: 'RF-VENTAS', tipo: 'RETEFUENTE', nombre: 'Retención que nos practican', tarifa: '2,5', baseMinimaUvt: '10', cuenta: '135515', aplicaEn: 'ventas' });
  await guardarConcepto(base, E, { codigo: 'RF-COMPRAS', tipo: 'RETEFUENTE', nombre: 'Retención compras', tarifa: '2,5', baseMinimaUvt: '10', cuenta: '236540', aplicaEn: 'compras' });
  return { base, cliente, proveedor };
}

describe('ventas y compras manuales', () => {
  it('factura de venta con IVA 19 % y exento, y retención que nos practican', async () => {
    const { base, cliente } = await empresa();
    const datos = {
      sentido: 'venta' as const, terceroId: cliente, fecha: '2026-09-10', numero: 'FV-POS-77', retenciones: ['RF-VENTAS'],
      items: [
        { descripcion: 'Router', cantidad: '2', valorUnitario: $('500000'), iva: { tipo: 'gravado' as const, tarifa: 190_000n } },
        { descripcion: 'Libro', cantidad: '1', valorUnitario: $('80000'), iva: { tipo: 'exento' as const } },
      ],
    };
    await expect(calcularFactura(base, E, datos)).rejects.toThrow(/UVT de 2026/);
    await guardarUvt(base, 2026, '52.374'); // valor de ejemplo
    const { totales, numeroLocal } = await crearFactura(base, E, datos);
    expect(numeroLocal).toMatch(/^FV-LOCAL-/);
    expect(totales).toMatchObject({ subtotal: $('1080000'), totalIva: $('190000'), total: $('1270000'), totalRetenciones: $('27000'), neto: $('1243000') });
    const [c] = await leerComprobantes(base, E);
    expect(c).toMatchObject({ tipo: 'FV', origen: 'factura_venta', concepto: 'Factura de venta FV-POS-77 — El Roble' });
    expect(c!.lineas.find((l) => l.cuenta === '135515')?.debito).toBe($('27000'));
  });

  it('compra con retención practicada, recaudos y pagos, y antigüedad por tercero', async () => {
    const { base, cliente, proveedor } = await empresa();
    await guardarUvt(base, 2026, '52.374');
    await crearFactura(base, E, {
      sentido: 'compra', terceroId: proveedor, fecha: '2026-06-01', numero: 'SN-500', retenciones: ['RF-COMPRAS'],
      items: [{ descripcion: 'Mercancía', cantidad: '10', valorUnitario: $('100000'), iva: { tipo: 'gravado', tarifa: 190_000n }, cuenta: '143505' }],
    });
    await crearFactura(base, E, {
      sentido: 'venta', terceroId: cliente, fecha: '2026-09-01', numero: 'V-1', retenciones: [],
      items: [{ descripcion: 'Servicio', cantidad: '1', valorUnitario: $('400000'), iva: { tipo: 'gravado', tarifa: 190_000n } }],
    });
    await registrarMovimientoTercero(base, E, { tipo: 'recaudo', terceroId: cliente, fecha: '2026-09-15', valor: $('100000'), cuentaBanco: '111005', referencia: 'Transferencia' });
    await registrarMovimientoTercero(base, E, { tipo: 'pago', terceroId: proveedor, fecha: '2026-09-20', valor: $('500000'), cuentaBanco: '111005' });
    await expect(registrarMovimientoTercero(base, E, { tipo: 'pago', terceroId: proveedor, fecha: '2026-09-20', valor: 0n, cuentaBanco: '111005' })).rejects.toThrow(ErrorLocal);

    const cartera = await antiguedadLocal(base, E, 'cartera', '2026-09-30');
    expect(cartera).toEqual([expect.objectContaining({ nombre: 'El Roble', saldo: $('376000'), rangos: expect.objectContaining({ r0_30: $('376000') }) })]);
    // Compra: 1.000.000 + IVA 190.000 − retención 25.000 = 1.165.000; pagado 500.000
    const porPagar = await antiguedadLocal(base, E, 'por_pagar', '2026-09-30');
    expect(porPagar).toEqual([expect.objectContaining({ nombre: 'Suministros del Norte', saldo: $('665000'), rangos: expect.objectContaining({ mas90: $('665000') }) })]);
    const tipos = (await leerComprobantes(base, E)).map((c) => `${c.tipo}:${c.origen}`).sort();
    expect(tipos).toEqual(['CE:pago', 'FC:factura_compra', 'FV:factura_venta', 'RC:recaudo']);
  });
});
