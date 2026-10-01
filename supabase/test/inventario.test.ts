import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const gerente: Sesion = { sub: randomUUID(), email: 'gerente@firma.co', aal: 'aal1' };
let db: PGlite;
let empresa: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, gerente.sub!, gerente.email!);
  const firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz') as f`)).f;
  empresa = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma])).e;
  const inv = await uno<{ r: { token: string } }>(ana, `select public.invitar_usuario($1, 'gerente@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: empresa, rol: 'Gerente' }])]);
  await como(db, gerente, 'select public.aceptar_invitacion($1)', [inv.r.token]);
});

const producto = (codigo: string, nombre: string) => ({
  id: randomUUID(), empresa_id: empresa, codigo, nombre, tipo: 'producto', unidad: 'UND', cuenta_inventario: '143505', iva_tipo: 'gravado', iva_tarifa_ppm: 190000,
});

describe('inventario en el servidor', () => {
  it('registra productos; el mismo código desde otro PC devuelve el id existente; el gerente no puede crear', async () => {
    const p1 = producto('RT-1', 'Router');
    expect((await uno<{ id: string }>(ana, 'select public.registrar_producto($1::jsonb) as id', [JSON.stringify(p1)])).id).toBe(p1.id);
    const p2 = { ...producto('RT-1', 'Router Wi-Fi 6'), id: randomUUID() };
    expect((await uno<{ id: string }>(ana, 'select public.registrar_producto($1::jsonb) as id', [JSON.stringify(p2)])).id).toBe(p1.id);
    expect(await uno(ana, 'select nombre from public.productos where id = $1', [p1.id])).toEqual({ nombre: 'Router Wi-Fi 6' });
    await expect(como(db, gerente, 'select public.registrar_producto($1::jsonb)', [JSON.stringify(producto('X', 'X'))])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('las líneas guardan producto y cantidad; anular devuelve las unidades', async () => {
    const p = producto('SW-24', 'Switch');
    await como(db, ana, 'select public.registrar_producto($1::jsonb)', [JSON.stringify(p)]);
    const r = await uno<{ r: { id: string; estado: string } }>(ana, 'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify({
      empresa_id: empresa, tipo: 'FV', fecha: '2026-09-10', concepto: 'Venta', clave_idempotencia: 'inv-1',
      lineas: [
        { cuenta: '613595', debito: '700000', credito: '0' },
        { cuenta: '143505', debito: '0', credito: '700000', producto_id: p.id, cantidad: '2.5' },
      ],
    })]);
    expect(r.r.estado).toBe('contabilizado');
    await como(db, ana, `select public.anular_comprobante($1, 'Devolución')`, [r.r.id]);
    const lineas = await como<{ debito: string; credito: string; cantidad: string; producto_id: string }>(db, ana,
      `select l.debito::text, l.credito::text, l.cantidad::text, l.producto_id::text from public.lineas l join public.comprobantes c on c.id = l.comprobante_id
        where l.producto_id = $1 order by c.creado_en, l.orden`, [p.id]);
    expect(lineas).toEqual([
      { debito: '0.00', credito: '700000.00', cantidad: '2.500', producto_id: p.id },
      { debito: '700000.00', credito: '0.00', cantidad: '2.500', producto_id: p.id }, // el reverso es una entrada
    ]);
  });

  it('una línea con producto debe traer cantidad positiva', async () => {
    const p = producto('CAM-4K', 'Cámara');
    await como(db, ana, 'select public.registrar_producto($1::jsonb)', [JSON.stringify(p)]);
    const r = await uno<{ r: { estado: string; motivo: string } }>(ana, 'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify({
      empresa_id: empresa, tipo: 'FC', fecha: '2026-09-10', concepto: 'Compra', clave_idempotencia: 'inv-2',
      lineas: [{ cuenta: '143505', debito: '100', credito: '0', producto_id: p.id }, { cuenta: '111005', debito: '0', credito: '100' }],
    })]);
    expect(r.r).toMatchObject({ estado: 'rechazado', motivo: expect.stringMatching(/lineas_producto_cantidad/) });
  });
});
