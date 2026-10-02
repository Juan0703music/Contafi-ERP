import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import type { Linea } from '@contafi/motor';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, guardarEmpresas, crearComprobante, leerComprobantes, sincronizar, planDeCuentas, crearCuenta, editarCuenta,
  descartarCuentaRechazada, leerPucCsv, importarPuc,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };
let db: PGlite;
let empresa: string;
let firma: string;

const D = (cuenta: string, v: string): Linea => ({ cuenta, debito: $(v), credito: 0n });
const C = (cuenta: string, v: string): Linea => ({ cuenta, debito: 0n, credito: $(v) });

async function nuevoPC(sesion: Sesion) {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa, firma_id: firma, nit: '900123456', dv: 8, razon_social: 'Andina SAS' }]);
  const { transporte, estado } = transporteDirecto(db, sesion);
  const dispositivo = { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' };
  const sync = () => sincronizar(base, transporte, { empresa, dispositivo });
  await sync();
  const cuenta = async (codigo: string) => (await planDeCuentas(base, empresa)).find((c) => c.codigo === codigo);
  return { base, estado, sync, cuenta };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, carla.sub!, carla.email!);
  firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma]))[0]!.e;
  const inv = (await enServidor<{ r: { token: string } }>(db, ana, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: empresa, rol: 'AuxContable' }])]))[0]!;
  await enServidor(db, carla, 'select public.aceptar_invitacion($1)', [inv.r.token]);
});

describe('PUC personalizable', () => {
  it('sin conexión: crea la auxiliar y la usa; al sincronizar el servidor la acepta y llega al otro PC', async () => {
    const pc1 = await nuevoPC(ana);
    const pc2 = await nuevoPC(ana);
    pc1.estado.enLinea = false;
    await crearCuenta(pc1.base, empresa, '11200501', { nombre: 'Davivienda ahorros 9981' });
    expect(await pc1.cuenta('11200501')).toMatchObject({ naturaleza: 'D', nivel: 5, aceptaMovimiento: true, pendiente: true, enServidor: false });
    expect(await pc1.cuenta('112005')).toMatchObject({ aceptaMovimiento: false });
    await crearComprobante(pc1.base, empresa, { tipo: 'CG', fecha: '2026-09-10', concepto: 'Consignación', lineas: [D('11200501', '250000'), C('310505', '250000')] });
    expect((await pc1.sync()).error).toMatch(/conexión/);
    pc1.estado.enLinea = true;
    const r = await pc1.sync();
    expect(r).toMatchObject({ contabilizados: 1, rechazados: 0, cuentasRechazadas: 0, error: null });
    expect(await pc1.cuenta('11200501')).toMatchObject({ pendiente: false, enServidor: true, errorSync: null });
    await pc2.sync();
    expect(await pc2.cuenta('11200501')).toMatchObject({ nombre: 'Davivienda ahorros 9981', aceptaMovimiento: true });
    expect(await pc2.cuenta('112005')).toMatchObject({ aceptaMovimiento: false });
  });

  it('las mismas reglas que el servidor, sin conexión', async () => {
    const pc = await nuevoPC(ana);
    const err = (p: Promise<unknown>) => p.then(() => 'sin error', (e: { codigo: string }) => e.codigo);
    expect(await err(crearCuenta(pc.base, empresa, '19', { nombre: 'Grupo' }))).toBe('CODIGO_INVALIDO');
    expect(await err(crearCuenta(pc.base, empresa, '11200501', { nombre: 'Otra vez' }))).toBe('CUENTA_EXISTE');
    expect(await err(crearCuenta(pc.base, empresa, '13809901', { nombre: 'Sin padre' }))).toBe('SIN_CUENTA_PADRE');
    expect(await err(crearCuenta(pc.base, empresa, '1120050101', { nombre: 'Bajo una con movimientos' }))).toBe('PADRE_CON_MOVIMIENTOS');
    expect(await err(editarCuenta(pc.base, empresa, '11200501', { nombre: 'Davivienda', activa: false }))).toBe('CUENTA_CON_SALDO');
    expect(await err(editarCuenta(pc.base, empresa, '112005', { nombre: 'Ahorros', activa: false }))).toBe('TIENE_SUBCUENTAS');
    expect(await err(crearCuenta(pc.base, empresa, '11200502', { nombre: '  ' }))).toBe('NOMBRE_INVALIDO');
    await editarCuenta(pc.base, empresa, '11200501', { nombre: 'Davivienda ahorros 9981-2', exigeTercero: true });
    await pc.sync();
    expect(await enServidor(db, ana, `select nombre, exige_tercero from public.cuentas where empresa_id = $1 and codigo = '11200501'`, [empresa]))
      .toEqual([{ nombre: 'Davivienda ahorros 9981-2', exige_tercero: true }]);
  });

  it('el servidor rechaza a quien no administra el PUC: la nueva se puede descartar y la edición se deshace', async () => {
    const pc = await nuevoPC(carla);
    await crearCuenta(pc.base, empresa, '13050501', { nombre: 'Clientes Bogotá' });
    await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-11', concepto: 'Venta', lineas: [D('519595', '1000'), C('13050501', '1000')] });
    await editarCuenta(pc.base, empresa, '11200501', { nombre: 'Renombrada por la auxiliar' });
    const r = await pc.sync();
    expect(r).toMatchObject({ cuentasRechazadas: 2, rechazados: 1, error: null });
    expect(await pc.cuenta('13050501')).toMatchObject({ enServidor: false, pendiente: false, errorSync: expect.stringMatching(/SIN_PERMISO/) });
    expect(await pc.cuenta('11200501')).toMatchObject({ nombre: 'Davivienda ahorros 9981-2', enServidor: true, errorSync: expect.stringMatching(/SIN_PERMISO/) });
    expect((await leerComprobantes(pc.base, empresa)).find((c) => c.concepto === 'Venta')?.estado).toBe('rechazado');
    await descartarCuentaRechazada(pc.base, empresa, '13050501');
    expect(await pc.cuenta('13050501')).toBeUndefined();
    expect(await pc.cuenta('130505')).toMatchObject({ aceptaMovimiento: true }); // vuelve a ser auxiliar
    await descartarCuentaRechazada(pc.base, empresa, '11200501');
    expect(await pc.cuenta('11200501')).toMatchObject({ nombre: 'Davivienda ahorros 9981-2', errorSync: null });
    expect((await pc.sync()).enviados).toBe(0);
  });
});

describe('importar el plan de cuentas (migración asistida)', () => {
  it('lee el CSV y crea solo lo que falta, de padre a hijo, aunque el archivo venga desordenado', async () => {
    const pc = await nuevoPC(ana);
    const lectura = leerPucCsv(['Código;Nombre;Exige tercero', '12050501;Acciones Ecopetrol;si', '1205;Acciones;', '120505;Acciones sociedades nacionales;no',
      '1105.05;Caja general;', '13;Deudores', '123;Malo;', '1210;;', '16;Inventario que no es grupo'].join('\n'));
    expect(lectura.errores).toEqual(['Fila 7: código "123" inválido (1, 2, 4, 6, 8, 10 o 12 dígitos).', 'Fila 8: falta el nombre de la cuenta 1210.']);
    const r = await importarPuc(pc.base, empresa, lectura.filas);
    expect(r).toEqual({ creadas: 3, existentes: 3, errores: [] });
    expect(await pc.cuenta('12050501')).toMatchObject({ exigeTercero: true, aceptaMovimiento: true, pendiente: true });
    expect(await pc.cuenta('120505')).toMatchObject({ aceptaMovimiento: false });
    expect(await pc.cuenta('16')).toMatchObject({ nombre: 'Intangibles' }); // el grupo existente no se toca
    // Sin padre y con un padre que ya tiene movimientos: se informa por cuenta
    const r2 = await importarPuc(pc.base, empresa, [{ codigo: '13809901', nombre: 'Sin padre', exigeTercero: false }, { codigo: '1120050101', nombre: 'Bajo una con movimientos', exigeTercero: false }]);
    expect(r2.creadas).toBe(0);
    expect(r2.errores[0]).toMatch(/^13809901 Sin padre: Primero cree la cuenta 138099/);
    expect(r2.errores[1]).toMatch(/1120050101.*ya tiene movimientos/);
    expect((await pc.sync()).cuentasRechazadas).toBe(0);
  });
});
