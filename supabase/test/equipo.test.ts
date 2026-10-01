import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const ana1: Sesion = { ...ana, aal: 'aal1' };
const luis: Sesion = { sub: randomUUID(), email: 'luis@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };
const eva: Sesion = { sub: randomUUID(), email: 'eva@otra.co', aal: 'aal2' };
let db: PGlite;
let firma: string;
let andina: string;
let espiga: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;
const equipo = async (s: Sesion) => (await uno<{ e: {
  miembros: { correo: string; rol_firma: string; empresas: { empresa_id: string; rol: string }[] }[];
  invitaciones: { correo: string }[];
} }>(s, 'select public.equipo_firma($1) as e', [firma])).e;

async function invitarYAceptar(quien: Sesion, rolFirma: string, empresas: { empresa_id: string; rol: string }[]) {
  const inv = await uno<{ r: { token: string } }>(ana, 'select public.invitar_usuario($1, $2, $3::public.rol_firma, $4::jsonb) as r',
    [firma, quien.email, rolFirma, JSON.stringify(empresas)]);
  await como(db, quien, 'select public.aceptar_invitacion($1)', [inv.r.token]);
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!, 'Ana Ortiz');
  await registrarUsuario(db, luis.sub!, luis.email!, 'Luis Pardo');
  await registrarUsuario(db, carla.sub!, carla.email!, 'Carla Ruiz');
  await registrarUsuario(db, eva.sub!, eva.email!);
  firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz Contadores') as f`)).f;
  andina = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma])).e;
  espiga = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga') as e`, [firma])).e;
  await invitarYAceptar(luis, 'administrador', []);
  await invitarYAceptar(carla, 'miembro', [{ empresa_id: andina, rol: 'AuxContable' }]);
});

describe('equipo de la firma', () => {
  it('mis firmas: cada usuario ve las suyas con su rol', async () => {
    expect((await uno<{ f: unknown }>(ana, 'select public.mis_firmas() as f')).f).toEqual([{ id: firma, nombre: 'Ortiz Contadores', rol: 'propietario' }]);
    expect((await uno<{ f: unknown }>(carla, 'select public.mis_firmas() as f')).f).toEqual([{ id: firma, nombre: 'Ortiz Contadores', rol: 'miembro' }]);
    expect((await uno<{ f: unknown }>(eva, 'select public.mis_firmas() as f')).f).toEqual([]);
  });

  it('el administrador ve miembros con sus roles por empresa e invitaciones pendientes', async () => {
    await uno(ana, `select public.invitar_usuario($1, 'nuevo@firma.co', 'miembro', '[]'::jsonb)`, [firma]);
    const e = await equipo(ana);
    expect(e.miembros.map((m) => [m.correo, m.rol_firma, m.empresas])).toEqual([
      ['ana@firma.co', 'propietario', []],
      ['luis@firma.co', 'administrador', []],
      ['carla@firma.co', 'miembro', [{ empresa_id: andina, rol: 'AuxContable' }]],
    ]);
    expect(e.invitaciones.map((i) => i.correo)).toEqual(['nuevo@firma.co']);
    await expect(equipo(carla)).rejects.toThrow(/SIN_PERMISO/);
    await expect(equipo(ana1)).rejects.toThrow(/SIN_PERMISO/); // sin MFA no ejerce como administrador
  });

  it('asignar y quitar roles por empresa; la persona debe ser de la firma', async () => {
    await como(db, ana, `select public.asignar_rol_empresa($1, $2, 'Contador')`, [espiga, carla.sub]);
    await como(db, ana, `select public.asignar_rol_empresa($1, $2, 'Contador')`, [andina, carla.sub]);
    expect((await equipo(ana)).miembros.find((m) => m.correo === 'carla@firma.co')!.empresas)
      .toEqual([{ empresa_id: andina, rol: 'Contador' }, { empresa_id: espiga, rol: 'Contador' }]);
    await como(db, ana, 'select public.asignar_rol_empresa($1, $2, null)', [espiga, carla.sub]);
    expect((await como(db, carla, 'select id from public.empresas')).length).toBe(1);
    await expect(como(db, ana, `select public.asignar_rol_empresa($1, $2, 'Gerente')`, [andina, eva.sub])).rejects.toThrow(/NO_ES_MIEMBRO/);
    await expect(como(db, carla, `select public.asignar_rol_empresa($1, $2, 'SuperAdmin')`, [andina, carla.sub])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('nadie escribe membresías ni permisos directamente (antes un administrador podía quitarle la firma al propietario)', async () => {
    await expect(como(db, luis, `delete from public.membresias where firma_id = $1 and usuario_id = $2`, [firma, ana.sub])).rejects.toThrow(/permission denied/);
    await expect(como(db, luis, `update public.membresias set rol = 'miembro' where usuario_id = $1`, [ana.sub])).rejects.toThrow(/permission denied/);
    await expect(como(db, carla, `insert into public.empresa_permisos values ($1, $2, 'SuperAdmin')`, [espiga, carla.sub])).rejects.toThrow(/permission denied/);
  });

  it('roles de firma y quitar miembros, protegiendo al propietario', async () => {
    await expect(como(db, luis, `select public.cambiar_rol_firma($1, $2, 'miembro')`, [firma, ana.sub])).rejects.toThrow(/ROL_INVALIDO/);
    await expect(como(db, luis, `select public.cambiar_rol_firma($1, $2, 'propietario')`, [firma, carla.sub])).rejects.toThrow(/ROL_INVALIDO/);
    await expect(como(db, luis, 'select public.quitar_miembro($1, $2)', [firma, ana.sub])).rejects.toThrow(/ROL_INVALIDO/);
    await expect(como(db, luis, 'select public.quitar_miembro($1, $2)', [firma, luis.sub])).rejects.toThrow(/NO_A_SI_MISMO/);
    await como(db, ana, `select public.cambiar_rol_firma($1, $2, 'administrador')`, [firma, carla.sub]);
    expect((await uno<{ f: { rol: string }[] }>(carla, 'select public.mis_firmas() as f')).f[0]!.rol).toBe('administrador');
    await como(db, ana, `select public.cambiar_rol_firma($1, $2, 'miembro')`, [firma, carla.sub]);
    await como(db, luis, 'select public.quitar_miembro($1, $2)', [firma, carla.sub]);
    expect(await como(db, carla, 'select id from public.empresas')).toEqual([]);
    expect((await uno<{ f: unknown[] }>(carla, 'select public.mis_firmas() as f')).f).toEqual([]);
    // Auditoría completa (se consulta como el sistema: las acciones de firma no son de una empresa).
    expect((await db.query(`select accion, count(*)::int as n from public.auditoria
                             where accion in ('ASIGNAR_ROL', 'CAMBIAR_ROL_FIRMA', 'QUITAR_MIEMBRO') group by accion order by accion`)).rows)
      .toEqual([{ accion: 'ASIGNAR_ROL', n: 3 }, { accion: 'CAMBIAR_ROL_FIRMA', n: 2 }, { accion: 'QUITAR_MIEMBRO', n: 1 }]);
  });
});
