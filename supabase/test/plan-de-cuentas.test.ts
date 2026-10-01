import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const contador: Sesion = { sub: randomUUID(), email: 'contador@firma.co', aal: 'aal1' };
const auxiliar: Sesion = { sub: randomUUID(), email: 'aux@firma.co', aal: 'aal1' };
let db: PGlite;
let empresa: string;
const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;
const registrar = (s: Sesion, c: Record<string, unknown>) =>
  como(db, s, 'select public.registrar_cuenta($1::jsonb)', [JSON.stringify({ empresa_id: empresa, ...c })]);
const cuenta = (codigo: string) => uno<Record<string, unknown>>(ana,
  'select nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, activa from public.cuentas where empresa_id = $1 and codigo = $2', [empresa, codigo]);
const comprobante = (clave: string, lineas: unknown[]) => uno<{ r: { estado: string; motivo: string | null } }>(ana,
  'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify({ empresa_id: empresa, tipo: 'CG', fecha: '2026-09-15', concepto: 'Prueba', clave_idempotencia: clave, lineas })]);

beforeAll(async () => {
  db = await crearBaseDePrueba();
  for (const u of [ana, contador, auxiliar]) await registrarUsuario(db, u.sub!, u.email!);
  const firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz') as f`)).f;
  empresa = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma])).e;
  for (const [u, rol] of [[contador, 'Contador'], [auxiliar, 'AuxContable']] as const) {
    const inv = await uno<{ r: { token: string } }>(ana, `select public.invitar_usuario($1, $2, 'miembro', $3::jsonb) as r`,
      [firma, u.email, JSON.stringify([{ empresa_id: empresa, rol }])]);
    await como(db, u, 'select public.aceptar_invitacion($1)', [inv.r.token]);
  }
});

describe('PUC personalizable en el servidor', () => {
  it('el contador crea auxiliares: heredan la naturaleza y el padre deja de recibir movimientos', async () => {
    expect(await cuenta('111005')).toMatchObject({ acepta_movimiento: true });
    await registrar(contador, { codigo: '11100501', nombre: 'Bancolombia ahorros 123', exige_tercero: false });
    await registrar(contador, { codigo: '11100502', nombre: 'Davivienda corriente 456' });
    expect(await cuenta('11100501')).toEqual({ nombre: 'Bancolombia ahorros 123', naturaleza: 'D', nivel: 5, acepta_movimiento: true, exige_tercero: false, activa: true });
    expect(await cuenta('111005')).toMatchObject({ acepta_movimiento: false });
    // Los cambios bajan a los demás PC.
    expect((await como(db, ana, `select registro_id from public.cambios where empresa_id = $1 and tabla = 'cuentas' and registro_id in ('111005', '11100501')`, [empresa])).length).toBeGreaterThanOrEqual(2);
    // Una subcuenta bajo una cuenta de naturaleza crédito (depreciación acumulada) es crédito.
    await registrar(contador, { codigo: '15922001', nombre: 'Depreciación portátiles' });
    expect(await cuenta('15922001')).toMatchObject({ naturaleza: 'C', nivel: 5 });
    const r = await comprobante('puc-1', [{ cuenta: '11100501', debito: '5000', credito: '0' }, { cuenta: '310505', debito: '0', credito: '5000' }]);
    expect(r.r.estado).toBe('contabilizado');
    const r2 = await comprobante('puc-2', [{ cuenta: '111005', debito: '5000', credito: '0' }, { cuenta: '310505', debito: '0', credito: '5000' }]);
    expect(r2.r).toMatchObject({ estado: 'rechazado', motivo: expect.stringMatching(/111005 \(no es auxiliar\)/) });
  });

  it('reglas: código, padre, padre con movimientos, saldo al inactivar, subcuentas activas', async () => {
    await expect(registrar(contador, { codigo: '19', nombre: 'Grupo nuevo' })).rejects.toThrow(/CODIGO_INVALIDO/);
    await expect(registrar(contador, { codigo: '1234567', nombre: 'Siete dígitos' })).rejects.toThrow(/CODIGO_INVALIDO/);
    await expect(registrar(contador, { codigo: '13809901', nombre: 'Sin padre' })).rejects.toThrow(/SIN_CUENTA_PADRE: primero cree la cuenta 138099/);
    await expect(registrar(contador, { codigo: '1110050101', nombre: 'Bajo una cuenta con movimientos' })).rejects.toThrow(/PADRE_CON_MOVIMIENTOS/);
    await expect(registrar(contador, { codigo: '11100501', nombre: 'Bancolombia', activa: false })).rejects.toThrow(/CUENTA_CON_SALDO/);
    await expect(registrar(contador, { codigo: '111005', nombre: 'Bancos', activa: false })).rejects.toThrow(/TIENE_SUBCUENTAS/);
    await expect(registrar(contador, { codigo: '11100502', nombre: ' ' })).rejects.toThrow(/NOMBRE_INVALIDO/);
    // Sin saldo sí se inactiva, y entonces no recibe movimientos ni subcuentas.
    await registrar(contador, { codigo: '11100502', nombre: 'Davivienda (cerrada)', activa: false });
    expect(await cuenta('11100502')).toMatchObject({ nombre: 'Davivienda (cerrada)', activa: false });
    await expect(registrar(contador, { codigo: '1110050201', nombre: 'X' })).rejects.toThrow(/PADRE_INACTIVO/);
    const r = await comprobante('puc-3', [{ cuenta: '11100502', debito: '1', credito: '0' }, { cuenta: '310505', debito: '0', credito: '1' }]);
    expect(r.r.motivo).toMatch(/11100502 \(inactiva\)/);
  });

  it('editar: nombre y exigencias; la naturaleza y el nivel no cambian', async () => {
    await registrar(contador, { codigo: '11100501', nombre: 'Bancolombia ahorros 123-45', exige_tercero: true, naturaleza: 'C', nivel: 1 });
    expect(await cuenta('11100501')).toMatchObject({ nombre: 'Bancolombia ahorros 123-45', naturaleza: 'D', nivel: 5, exige_tercero: true });
  });

  it('solo contabilidad FULL; nadie escribe la tabla directamente', async () => {
    await expect(registrar(auxiliar, { codigo: '11100503', nombre: 'Del auxiliar' })).rejects.toThrow(/SIN_PERMISO/);
    await expect(como(db, contador, `update public.cuentas set naturaleza = 'C' where empresa_id = $1 and codigo = '11100501'`, [empresa]))
      .rejects.toThrow(/permission denied/);
    await expect(como(db, ana, `insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel) values ($1, '11100599', 'X', 'D', 5)`, [empresa]))
      .rejects.toThrow(/permission denied/);
    await registrar(ana, { codigo: '11100503', nombre: 'Del administrador' });
    expect(await cuenta('11100503')).toMatchObject({ nombre: 'Del administrador' });
  });
});
