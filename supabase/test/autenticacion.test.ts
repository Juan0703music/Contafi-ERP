import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PUC_SEMILLA, aceptaMovimientoEnPlantilla, calcularDV } from '@contafi/shared';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';
import { generarPlantillaPuc, RUTA_MIGRACION } from '../scripts/generar-plantilla-puc.ts';

const ID = {
  ana: 'a0000000-0000-4000-8000-000000000001',
  carla: 'a0000000-0000-4000-8000-000000000003',
  eva: 'a0000000-0000-4000-8000-000000000005',
  beto: 'a0000000-0000-4000-8000-000000000002',
};
const ana1: Sesion = { sub: ID.ana, email: 'ana@firma.co', aal: 'aal1' };
const ana2: Sesion = { ...ana1, aal: 'aal2' };
const carla: Sesion = { sub: ID.carla, email: 'carla@firma.co', aal: 'aal1' };
const eva: Sesion = { sub: ID.eva, email: 'eva@otra.co', aal: 'aal1' };
const beto2: Sesion = { sub: ID.beto, email: 'beto@norte.co', aal: 'aal2' };

let db: PGlite;
let firma: string;
let empresa: string;

const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ID.ana, 'Ana@Firma.co', 'Ana Ortiz');
  await registrarUsuario(db, ID.carla, 'carla@firma.co');
  await registrarUsuario(db, ID.eva, 'eva@otra.co');
  await registrarUsuario(db, ID.beto, 'beto@norte.co');
});

describe('registro y perfil', () => {
  it('Supabase Auth crea el perfil con nombre y correo en minúsculas', async () => {
    expect(await uno(ana1, 'select nombre, correo from public.usuarios where id = $1', [ID.ana])).toEqual({ nombre: 'Ana Ortiz', correo: 'ana@firma.co' });
    expect(await uno(carla, 'select nombre from public.usuarios where id = $1', [ID.carla])).toEqual({ nombre: 'carla' });
  });
});

describe('firmas, MFA obligatorio para administradores y alta de empresas', () => {
  it('quien crea la firma queda como propietario', async () => {
    firma = (await uno<{ f: string }>(ana1, `select public.crear_firma('Ortiz Contadores') as f`)).f;
    expect(await uno(ana2, 'select rol from public.membresias where firma_id = $1', [firma])).toEqual({ rol: 'propietario' });
  });

  it('sin MFA verificado, el administrador debe configurarlo y no ejerce como administrador', async () => {
    expect((await uno<{ r: boolean }>(ana1, 'select public.requiere_mfa() as r')).r).toBe(true);
    expect((await uno<{ r: boolean }>(ana2, 'select public.requiere_mfa() as r')).r).toBe(false);
    expect((await uno<{ r: boolean }>(carla, 'select public.requiere_mfa() as r')).r).toBe(false); // no es admin
    await expect(como(db, ana1, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS')`, [firma])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('rechaza el NIT con dígito de verificación errado (como el del prototipo)', async () => {
    await expect(como(db, ana2, `select public.crear_empresa($1, '900.123.456', 7::smallint, 'Andina SAS')`, [firma]))
      .rejects.toThrow(/DV_INVALIDO.*es 8/);
  });

  it('crea la empresa con el PUC de la plantilla y los tipos de comprobante', async () => {
    empresa = (await uno<{ e: string }>(ana2, `select public.crear_empresa($1, '900.123.456', 8::smallint, 'Comercializadora Andina SAS') as e`, [firma])).e;
    const cuentas = await como<{ codigo: string; nivel: number; acepta_movimiento: boolean; exige_tercero: boolean }>(db, ana2,
      'select codigo, nivel, acepta_movimiento, exige_tercero from public.cuentas where empresa_id = $1', [empresa]);
    expect(cuentas).toHaveLength(PUC_SEMILLA.length);
    for (const c of cuentas) {
      expect(c.acepta_movimiento, c.codigo).toBe(aceptaMovimientoEnPlantilla(c.codigo)); // SQL y TypeScript coinciden
    }
    expect(cuentas.find((c) => c.codigo === '130505')).toMatchObject({ nivel: 4, acepta_movimiento: true, exige_tercero: true });
    const tipos = await como<{ codigo: string }>(db, ana2, 'select codigo from public.tipos_comprobante where empresa_id = $1 order by codigo', [empresa]);
    expect(tipos.map((t) => t.codigo)).toEqual(['CC', 'CE', 'CG', 'FC', 'FV', 'NC', 'ND', 'RC', 'SI']);
  });

  it('el administrador sin MFA no ve las empresas; con MFA sí', async () => {
    expect(await como(db, ana1, 'select id from public.empresas')).toEqual([]);
    expect(await como(db, ana2, 'select id from public.empresas')).toHaveLength(1);
  });

  it('dv_nit en SQL coincide con calcularDV en TypeScript', async () => {
    const nits = ['800197268', '860034313', '890903938', '1', '52330114', '1032556789', '999999999999999'];
    for (let i = 0; i < 40; i++) nits.push(String(Math.floor(Math.random() * 1e12)));
    for (const n of nits) {
      expect((await uno<{ dv: number }>(ana1, 'select public.dv_nit($1) as dv', [n])).dv, n).toBe(calcularDV(n));
    }
  });

  it('la migración del PUC está al día con packages/shared/src/puc.ts', () => {
    expect(readFileSync(RUTA_MIGRACION, 'utf8'), 'Ejecute: pnpm --filter @contafi/supabase generar-puc').toBe(generarPlantillaPuc());
  });
});

describe('invitaciones', () => {
  let token: string;

  it('solo un administrador con MFA invita, y solo a empresas de su firma', async () => {
    const emp = JSON.stringify([{ empresa_id: empresa, rol: 'Contador' }]);
    await expect(como(db, ana1, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb)`, [firma, emp])).rejects.toThrow(/SIN_PERMISO/);
    await expect(como(db, carla, `select public.invitar_usuario($1, 'x@y.co', 'miembro', '[]')`, [firma])).rejects.toThrow(/SIN_PERMISO/);
    await expect(como(db, ana2, `select public.invitar_usuario($1, 'x@y.co', 'propietario', '[]')`, [firma])).rejects.toThrow(/ROL_INVALIDO/);
    await expect(como(db, ana2, `select public.invitar_usuario($1, 'x@y.co', 'miembro', $2::jsonb)`,
      [firma, JSON.stringify([{ empresa_id: empresa, rol: 'Jefe' }])])).rejects.toThrow(/invalid input value for enum/);
    // Empresa de otra firma
    const firmaBeto = (await uno<{ f: string }>(beto2, `select public.crear_firma('Norte') as f`)).f;
    const empBeto = (await uno<{ e: string }>(beto2, `select public.crear_empresa($1, '901223556', 9::smallint, 'Norte SAS') as e`, [firmaBeto])).e;
    await expect(como(db, ana2, `select public.invitar_usuario($1, 'x@y.co', 'miembro', $2::jsonb)`,
      [firma, JSON.stringify([{ empresa_id: empBeto, rol: 'Contador' }])])).rejects.toThrow(/EMPRESA_AJENA/);

    const r = await uno<{ r: { id: string; token: string } }>(ana2, `select public.invitar_usuario($1, ' Carla@Firma.co ', 'miembro', $2::jsonb) as r`, [firma, emp]);
    token = r.r.token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const guardada = await uno<{ correo: string; token_hash: string }>(ana2, 'select correo, token_hash from public.invitaciones where id = $1', [r.r.id]);
    expect(guardada.correo).toBe('carla@firma.co');
    expect(guardada.token_hash).not.toContain(token); // solo se guarda el hash
    expect(await como(db, carla, 'select * from public.invitaciones')).toEqual([]); // un miembro no ve invitaciones
  });

  it('solo la acepta el dueño del correo, una sola vez', async () => {
    await expect(como(db, eva, 'select public.aceptar_invitacion($1)', [token])).rejects.toThrow(/INVITACION_OTRO_CORREO/);
    await expect(como(db, carla, 'select public.aceptar_invitacion($1)', ['0'.repeat(64)])).rejects.toThrow(/INVITACION_INVALIDA/);
    expect((await uno<{ f: string }>(carla, 'select public.aceptar_invitacion($1) as f', [token])).f).toBe(firma);
    await expect(como(db, carla, 'select public.aceptar_invitacion($1)', [token])).rejects.toThrow(/INVITACION_INVALIDA/);
  });

  it('tras aceptar, la invitada trabaja con su rol en la empresa (Contador contabiliza)', async () => {
    expect(await uno(carla, 'select rol from public.empresa_permisos where usuario_id = $1', [ID.carla])).toEqual({ rol: 'Contador' });
    const [t] = await como<{ id: string }>(db, ana2,
      `insert into public.terceros (empresa_id, tipo_doc, numero, nombre) values ($1, '31', '830945221', 'El Roble') returning id`, [empresa]);
    const r = await uno<{ r: { estado: string; numero: string } }>(carla, 'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify({
      empresa_id: empresa, tipo: 'FV', fecha: '2026-09-30', concepto: 'Venta', clave_idempotencia: 'c-1',
      lineas: [{ cuenta: '130505', tercero_id: t!.id, debito: '119000', credito: '0' }, { cuenta: '413595', debito: '0', credito: '119000' }],
    })]);
    expect(r.r).toMatchObject({ estado: 'contabilizado', numero: 'FV-000001' });
    // Pero no puede crear empresas ni invitar (es miembro, no administrador)
    await expect(como(db, { ...carla, aal: 'aal2' }, `select public.invitar_usuario($1, 'z@z.co', 'miembro', '[]')`, [firma])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('las invitaciones vencidas o revocadas no sirven', async () => {
    const a = await uno<{ r: { id: string; token: string } }>(ana2, `select public.invitar_usuario($1, 'eva@otra.co', 'miembro', '[]') as r`, [firma]);
    await db.query(`update public.invitaciones set expira_en = now() - interval '1 minute' where id = $1`, [a.r.id]);
    await expect(como(db, eva, 'select public.aceptar_invitacion($1)', [a.r.token])).rejects.toThrow(/INVITACION_INVALIDA/);
    const b = await uno<{ r: { id: string; token: string } }>(ana2, `select public.invitar_usuario($1, 'eva@otra.co', 'miembro', '[]') as r`, [firma]);
    await como(db, ana2, 'select public.revocar_invitacion($1)', [b.r.id]);
    await expect(como(db, eva, 'select public.aceptar_invitacion($1)', [b.r.token])).rejects.toThrow(/INVITACION_INVALIDA/);
  });
});
