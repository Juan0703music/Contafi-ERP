import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { aMilesimas } from '@contafi/motor';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, guardarEmpresas, sincronizar, crearTercero, crearProducto, crearFactura, productosLocales, kardexLocal, existencias, ErrorLocal,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let empresa: string;

async function nuevoPC() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa, firma_id: 'f', nit: '900123456', dv: 8, razon_social: 'Andina' }]);
  const { transporte, estado } = transporteDirecto(db, ana);
  const sync = () => sincronizar(base, transporte, { empresa, dispositivo: { id: randomUUID(), nombre: 'PC', version_app: '1' } });
  await sync();
  return { base, sync, estado };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  const firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma]))[0]!.e;
});

describe('inventario básico', () => {
  it('valida y no duplica códigos', async () => {
    const { base } = await nuevoPC();
    await crearProducto(base, empresa, { codigo: 'RT-1', nombre: 'Router', tipo: 'producto', unidad: 'UND', iva: '19', precioVenta: '295.000' });
    await expect(crearProducto(base, empresa, { codigo: 'RT-1', nombre: 'Otro', tipo: 'producto', unidad: 'UND', iva: '19' })).rejects.toThrow(/Ya existe/);
    await expect(crearProducto(base, empresa, { codigo: 'X', nombre: 'X', tipo: 'producto', unidad: 'UND', iva: 'veinte' })).rejects.toThrow(ErrorLocal);
    expect((await productosLocales(base, empresa))[0]).toMatchObject({ codigo: 'RT-1', iva: { tipo: 'gravado', tarifa: 190_000n }, precioVenta: $('295000'), pendiente: true });
  });

  it('compras y ventas mueven el kárdex por costo promedio, sin conexión, y otro PC llega al mismo kárdex', async () => {
    const pc1 = await nuevoPC();
    pc1.estado.enLinea = false;
    const prov = await crearTercero(pc1.base, empresa, { tipo_doc: '31', numero: '901223556', dv: 9, nombre: 'Proveedor', tipos: ['proveedor'] });
    const cli = await crearTercero(pc1.base, empresa, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Cliente', tipos: ['cliente'] });
    const rt = await crearProducto(pc1.base, empresa, { codigo: 'RT-9', nombre: 'Router', tipo: 'producto', unidad: 'UND', iva: '19' });
    const item = (cantidad: string, valor: string) => ({ descripcion: 'Router', cantidad, valorUnitario: $(valor), iva: { tipo: 'gravado' as const, tarifa: 190_000n }, productoId: rt });
    await crearFactura(pc1.base, empresa, { sentido: 'compra', terceroId: prov, fecha: '2026-09-01', numero: 'C-1', retenciones: [], items: [item('10', '100000')] });
    await crearFactura(pc1.base, empresa, { sentido: 'compra', terceroId: prov, fecha: '2026-09-03', numero: 'C-2', retenciones: [], items: [item('5', '130000')] });
    const venta = await crearFactura(pc1.base, empresa, { sentido: 'venta', terceroId: cli, fecha: '2026-09-05', numero: 'V-1', retenciones: [], items: [item('3', '200000')] });
    expect(venta.avisos).toEqual([]);
    const k = await kardexLocal(pc1.base, empresa, rt);
    expect(k.estado).toMatchObject({ cantidad: aMilesimas('12'), valor: $('1320000'), costoUnitario: $('110000') });

    // Vender más de lo que hay (venta sin conexión): se permite y se avisa
    const sobreventa = await crearFactura(pc1.base, empresa, { sentido: 'venta', terceroId: cli, fecha: '2026-09-06', numero: 'V-2', retenciones: [], items: [item('13', '200000')] });
    expect(sobreventa.avisos[0]).toMatch(/queda negativa \(-1 UND\)/);

    // Vuelve la conexión: el producto viaja antes que las facturas
    pc1.estado.enLinea = true;
    const r = await pc1.sync();
    expect(r).toMatchObject({ contabilizados: 4, rechazados: 0, error: null });
    const pc2 = await nuevoPC();
    const [e1] = await existencias(pc1.base, empresa);
    const [e2] = await existencias(pc2.base, empresa);
    expect(e2).toMatchObject({ cantidad: e1!.cantidad, valor: e1!.valor, producto: expect.objectContaining({ codigo: 'RT-9', pendiente: false }) });
    expect(e2!.cantidad).toBe(-aMilesimas('1'));
  });
});
