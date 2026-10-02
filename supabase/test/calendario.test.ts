import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };
let db: PGlite;
let firma: string;
let andina: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;
// FECHAS DE EJEMPLO PARA PRUEBAS: no son las del decreto.
const filas = (extra: Record<string, unknown> = {}) => JSON.stringify([
  { obligacion: 'RETENCION', nombre: 'Retención en la fuente', periodo: '2026-09', digito: '8', fecha: '2026-10-14', ...extra },
  { obligacion: 'EXOGENA', nombre: 'Información exógena', periodo: '2025', digito: null, fecha: '2026-05-05' },
]);

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, carla.sub!, carla.email!);
  firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz') as f`)).f;
  andina = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma])).e;
  const inv = await uno<{ r: { token: string } }>(ana, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: andina, rol: 'AuxContable' }])]);
  await como(db, carla, 'select public.aceptar_invitacion($1)', [inv.r.token]);
});

describe('calendario tributario', () => {
  it('se carga por firma y año, avisa a todas sus empresas (también a las nuevas) y valida cada fila', async () => {
    await como(db, ana, 'select public.guardar_calendario($1, 2026, $2::jsonb)', [andina, filas()]);
    expect((await uno<{ n: number }>(carla, 'select jsonb_array_length(filas) as n from public.calendario_firma where anio = 2026')).n).toBe(2);
    const nueva = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga') as e`, [firma])).e;
    expect(await como(db, ana, `select registro_id from public.cambios where empresa_id = $1 and tabla = 'calendario'`, [nueva])).toEqual([{ registro_id: '2026' }]);
    for (const [extra, motivo] of [
      [{ fecha: '2026-02-30' }, /fila inválida/], [{ fecha: '2030-01-01' }, /fila inválida/], [{ digito: '12' }, /fila inválida/],
      [{ obligacion: 'iva bim' }, /fila inválida/], [{ nombre: '' }, /fila inválida/],
    ] as const) {
      await expect(como(db, ana, 'select public.guardar_calendario($1, 2026, $2::jsonb)', [andina, filas(extra)])).rejects.toThrow(motivo);
    }
    await expect(como(db, carla, 'select public.guardar_calendario($1, 2026, $2::jsonb)', [andina, filas()])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('obligaciones por empresa: únicas y ordenadas; solo contabilidad FULL', async () => {
    await como(db, ana, `select public.guardar_obligaciones($1, array['RETENCION', 'IVA_BIM', 'RETENCION'])`, [andina]);
    expect(await uno(carla, 'select codigos from public.obligaciones_empresa where empresa_id = $1', [andina])).toEqual({ codigos: ['IVA_BIM', 'RETENCION'] });
    expect(await como(db, ana, `select 1 from public.cambios where empresa_id = $1 and tabla = 'obligaciones'`, [andina])).toHaveLength(1);
    await expect(como(db, ana, `select public.guardar_obligaciones($1, array['mal código'])`, [andina])).rejects.toThrow(/DATOS_INVALIDOS/);
    await expect(como(db, carla, `select public.guardar_obligaciones($1, array['IVA_BIM'])`, [andina])).rejects.toThrow(/SIN_PERMISO/);
    await expect(como(db, carla, `update public.obligaciones_empresa set codigos = '{}'`)).rejects.toThrow(/permission denied/);
  });
});
