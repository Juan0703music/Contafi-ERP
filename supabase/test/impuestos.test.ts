import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };
let db: PGlite;
let firma: string;
let andina: string;
let espiga: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;
const concepto = (extra: Record<string, unknown> = {}) => JSON.stringify({
  empresa_id: andina, codigo: 'rf-compras', tipo: 'RETEFUENTE', nombre: 'Compras generales', tarifa_ppm: 25000,
  base_minima_uvt: '10', cuenta: '236540', aplica_en: 'compras', ...extra,
});

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, carla.sub!, carla.email!);
  firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz') as f`)).f;
  andina = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma])).e;
  espiga = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga') as e`, [firma])).e;
  const inv = await uno<{ r: { token: string } }>(ana, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: andina, rol: 'AuxContable' }])]);
  await como(db, carla, 'select public.aceptar_invitacion($1)', [inv.r.token]);
});

describe('configuración tributaria compartida', () => {
  it('la UVT se guarda una vez para la firma y avisa a todas sus empresas (también a las nuevas)', async () => {
    await como(db, ana, 'select public.guardar_uvt($1, 2026, 49799)', [andina]);
    await como(db, ana, 'select public.guardar_uvt($1, 2026, 52374)', [andina]); // corrección
    expect(await como(db, carla, 'select anio, uvt::text from public.uvt_firma')).toEqual([{ anio: 2026, uvt: '52374.00' }]);
    const avisos = await como<{ empresa_id: string }>(db, ana, `select empresa_id from public.cambios where tabla = 'uvt' and registro_id = '2026'`);
    expect(new Set(avisos.map((a) => a.empresa_id))).toEqual(new Set([andina, espiga]));
    const nueva = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900555777', 0::smallint, 'El Tornillo') as e`, [firma])).e;
    expect(await como(db, ana, `select registro_id from public.cambios where empresa_id = $1 and tabla = 'uvt'`, [nueva])).toEqual([{ registro_id: '2026' }]);
  });

  it('valida la UVT y exige contabilidad FULL', async () => {
    await expect(como(db, ana, 'select public.guardar_uvt($1, 2026, 0)', [andina])).rejects.toThrow(/UVT_INVALIDA/);
    await expect(como(db, ana, 'select public.guardar_uvt($1, 1990, 1000)', [andina])).rejects.toThrow(/ANIO_INVALIDO/);
    await expect(como(db, carla, 'select public.guardar_uvt($1, 2026, 1)', [andina])).rejects.toThrow(/SIN_PERMISO/);
    await expect(como(db, carla, `insert into public.uvt_firma values ($1, 2027, 1)`, [firma])).rejects.toThrow(/permission denied/);
  });

  it('conceptos por empresa con las mismas reglas que la app; llegan como cambios', async () => {
    await como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto()]);
    expect(await como(db, carla, 'select codigo, tarifa_ppm::int, base_minima_uvt::text, activo from public.conceptos_empresa'))
      .toEqual([{ codigo: 'RF-COMPRAS', tarifa_ppm: 25000, base_minima_uvt: '10.000', activo: true }]);
    expect((await como(db, ana, `select 1 from public.cambios where empresa_id = $1 and tabla = 'conceptos_empresa' and registro_id = 'RF-COMPRAS'`, [andina])).length).toBe(1);
    await expect(como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ cuenta: '1105' })])).rejects.toThrow(/no es auxiliar/);
    await expect(como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ cuenta: '135515' })])).rejects.toThrow(/grupo 23/);
    await expect(como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ aplica_en: 'ventas' })])).rejects.toThrow(/grupo 13/);
    await expect(como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ tarifa_ppm: 2000000 })])).rejects.toThrow(/tarifa_ppm/);
    await expect(como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ codigo: 'x' })])).rejects.toThrow(/código/);
    await expect(como(db, carla, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto()])).rejects.toThrow(/SIN_PERMISO/);
    // Desactivar
    await como(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [concepto({ activo: false })]);
    expect(await uno(ana, 'select activo from public.conceptos_empresa where codigo = $1', ['RF-COMPRAS'])).toEqual({ activo: false });
    // Otra empresa de la firma no ve los conceptos de Andina si no tiene acceso
    expect(await como(db, carla, 'select 1 from public.conceptos_empresa where empresa_id = $1', [espiga])).toEqual([]);
  });
});
