import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const luis: Sesion = { sub: randomUUID(), email: 'luis@firma.co', aal: 'aal1' };
let db: PGlite;
let firma: string;
let empresa: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;
const sistema = (sql: string, p: unknown[] = []) => db.query(sql, p); // como Contafi (cobros), no como usuario
const estado = async () => (await uno<{ e: Record<string, unknown> }>(ana, 'select public.estado_suscripcion($1) as e', [firma])).e;
const comprobante = (clave: string) => como<{ r: { estado: string } }>(db, ana, 'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify({
  empresa_id: empresa, tipo: 'CG', fecha: '2026-09-15', concepto: 'x', clave_idempotencia: clave,
  lineas: [{ cuenta: '519595', debito: '100', credito: '0' }, { cuenta: '111005', debito: '0', credito: '100' }] })]);

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, luis.sub!, luis.email!);
  firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz') as f`)).f;
  await sistema(`update public.firmas set plan = 'prueba' where id = $1`, [firma]);
});

describe('planes y suscripción (sección 17)', () => {
  it('la prueba gratis dura 30 días y permite 1 usuario y 1 empresa real', async () => {
    empresa = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma])).e;
    expect(await estado()).toMatchObject({ plan: 'prueba', activa: true, usuarios_max: 1, empresas_max: 1, usuarios: 1, empresas: 1, dias_restantes: 30 });
    await expect(como(db, ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga')`, [firma])).rejects.toThrow(/LIMITE_PLAN: el plan de la firma permite 1 empresa/);
    await expect(como(db, ana, `select public.invitar_usuario($1, 'luis@firma.co', 'miembro', '[]'::jsonb)`, [firma])).rejects.toThrow(/LIMITE_PLAN.*1 usuario/);
  });

  it('con un plan pago y empresas adicionales sube el límite; las invitaciones pendientes cuentan como puestos', async () => {
    await sistema(`update public.firmas set plan = 'firma', pagado_hasta = current_date + 30, empresas_adicionales = 2 where id = $1`, [firma]);
    expect(await estado()).toMatchObject({ plan: 'firma', usuarios_max: 3, empresas_max: 32, activa: true });
    await uno(ana, `select public.invitar_usuario($1, 'luis@firma.co', 'miembro', '[]'::jsonb)`, [firma]);
    await uno(ana, `select public.invitar_usuario($1, 'otro@firma.co', 'miembro', '[]'::jsonb)`, [firma]);
    await expect(como(db, ana, `select public.invitar_usuario($1, 'tercero@firma.co', 'miembro', '[]'::jsonb)`, [firma])).rejects.toThrow(/LIMITE_PLAN.*3 usuario/);
  });

  it('vencida: modo consulta. Se puede leer, pero no escribir; el lote falla entero (no se rechaza nada)', async () => {
    expect((await comprobante('antes'))[0]!.r.estado).toBe('contabilizado');
    await sistema(`update public.firmas set pagado_hasta = current_date - 16 where id = $1`, [firma]); // pasó la gracia de 15 días
    expect(await estado()).toMatchObject({ activa: false });
    await expect(comprobante('despues')).rejects.toThrow(/SIN_PERMISO/);
    expect(await como(db, ana, `select count(*)::int as n from public.comprobantes where empresa_id = $1`, [empresa])).toEqual([{ n: 1 }]);
    expect((await como(db, ana, 'select codigo from public.cuentas where empresa_id = $1 limit 1', [empresa])).length).toBe(1); // lectura sí
    await expect(como(db, ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga')`, [firma])).rejects.toThrow(/SUSCRIPCION_VENCIDA/);
    // Dentro de la gracia sigue activa
    await sistema(`update public.firmas set pagado_hasta = current_date - 10 where id = $1`, [firma]);
    expect((await comprobante('en-gracia'))[0]!.r.estado).toBe('contabilizado');
  });

  it('nadie cambia su plan desde la app', async () => {
    await expect(como(db, ana, `update public.firmas set plan = 'firma_plus', pagado_hasta = '2099-01-01' where id = $1`, [firma])).rejects.toThrow(/permission denied/);
    await expect(como(db, ana, `update public.planes set precio_mensual = 0`)).rejects.toThrow(/permission denied/);
    await expect(como(db, luis, 'select public.estado_suscripcion($1)', [firma])).rejects.toThrow(/SIN_PERMISO/); // no es miembro (aún no acepta)
  });
});

describe('precios públicos', () => {
  it('el sitio web los lee sin sesión, pero no los puede cambiar', async () => {
    const anon: Sesion = { sub: null };
    const planes = await como<{ codigo: string; precio_mensual: string }>(db, anon, 'select codigo, precio_mensual::text from public.planes order by orden');
    expect(planes.map((p) => [p.codigo, p.precio_mensual])).toEqual([['prueba', '0.00'], ['independiente', '119000.00'], ['firma', '299000.00'], ['firma_plus', '649000.00']]);
    await expect(como(db, anon, 'update public.planes set precio_mensual = 1')).rejects.toThrow(/permission denied/);
    await expect(como(db, anon, 'select * from public.firmas')).rejects.toThrow(/permission denied/);
  });
});
