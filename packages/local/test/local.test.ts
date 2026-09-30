import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { ErrorMotor, type Linea } from '@contafi/motor';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, versionEsquema, guardarEmpresas, crearComprobante, crearTercero, leerComprobantes, estadoSincronizacion,
  balancePruebaLocal, guardarBorrador, leerBorrador, sincronizar, transporteHttp, ErrorTransporte, ErrorLocal,
  tercerosLocales, cuentasLocales, type BaseLocal,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };

let db: PGlite;
let empresa: string;
let firma: string;

const D = (cuenta: string, v: string, tercero: string | null = null): Linea => ({ cuenta, debito: $(v), credito: 0n, terceroId: tercero });
const C = (cuenta: string, v: string, tercero: string | null = null): Linea => ({ cuenta, debito: 0n, credito: $(v), terceroId: tercero });

/** Un PC con Contafi instalado, con su propia base local y su conexión. */
async function nuevoPC(sesion: Sesion, nombre: string) {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa, firma_id: firma, nit: '900123456', dv: 8, razon_social: 'Andina SAS' }]);
  const { transporte, estado } = transporteDirecto(db, sesion);
  const dispositivo = { id: randomUUID(), nombre, version_app: '0.3.0' };
  const sync = () => sincronizar(base, transporte, { empresa, dispositivo });
  await sync(); // descarga inicial (catálogos)
  return { base, estado, sync };
}

const numerosServidor = async () =>
  (await enServidor<{ numero: string }>(db, ana, `select numero from public.comprobantes where empresa_id = $1 and tipo = 'CG' and numero is not null order by numero`, [empresa])).map((x) => x.numero);

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  await registrarUsuario(db, carla.sub!, carla.email!);
  firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz Contadores') as f`))[0]!.f;
  empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma]))[0]!.e;
  const inv = (await enServidor<{ r: { token: string } }>(db, ana, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: empresa, rol: 'AuxContable' }])]))[0]!;
  await enServidor(db, carla, 'select public.aceptar_invitacion($1)', [inv.r.token]);
});

describe('base local', () => {
  it('aplica las migraciones una sola vez y rechaza una base de una versión más nueva', async () => {
    const b = baseNode();
    expect(await migrar(b)).toBe(3);
    expect(await migrar(b)).toBe(0);
    expect(await versionEsquema(b)).toBe(3);
    b.db.exec('pragma user_version = 99');
    await expect(migrar(b)).rejects.toThrow(/versión más nueva/);
  });

  it('la descarga inicial trae el PUC y los tipos de comprobante', async () => {
    const pc = await nuevoPC(ana, 'PC inicial');
    expect(await cuentasLocales(pc.base, empresa)).toHaveLength(124);
  });

  it('valida con el motor antes de guardar, sin conexión', async () => {
    const pc = await nuevoPC(ana, 'PC validación');
    pc.estado.enLinea = false;
    await expect(crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-01', concepto: 'x', lineas: [D('111005', '100'), C('310505', '99')] }))
      .rejects.toThrow(ErrorMotor);
    await expect(crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-01', concepto: 'x', lineas: [D('130505', '100', randomUUID()), C('413595', '100')] }))
      .rejects.toThrow(/tercero no existe/);
    await expect(crearTercero(pc.base, empresa, { tipo_doc: '31', numero: '830945221', dv: 3, nombre: 'El Roble' })).rejects.toThrow(ErrorLocal);
    const r = await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-01', concepto: 'Aporte', lineas: [D('111005', '100'), C('310505', '100')] });
    expect(r.numeroLocal).toMatch(/^CG-LOCAL-[0-9A-F]{4}$/);
    const [c] = await leerComprobantes(pc.base, empresa);
    expect(c).toMatchObject({ estado: 'pendiente_sync', numero: null, numeroLocal: r.numeroLocal });
    expect(c!.lineas[0]!.debito).toBe($('100'));
    expect(await estadoSincronizacion(pc.base, empresa)).toMatchObject({ pendientes: 1 });
  });

  it('autoguardado: recupera el formulario con montos exactos y se borra al guardar el comprobante', async () => {
    const pc = await nuevoPC(ana, 'PC autoguardado');
    await guardarBorrador(pc.base, 'form:nuevo', { concepto: 'A medio llenar', valor: $('1234567.89') }, empresa);
    expect((await leerBorrador<{ valor: bigint }>(pc.base, 'form:nuevo'))!.contenido.valor).toBe($('1234567.89'));
    await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-01', concepto: 'Listo', lineas: [D('111005', '1'), C('310505', '1')] }, { claveBorrador: 'form:nuevo' });
    expect(await leerBorrador(pc.base, 'form:nuevo')).toBeNull();
  });
});

describe('sección 13: dos PC sin conexión creando documentos', () => {
  it('ambos trabajan sin internet, crean el mismo tercero, y al volver todo queda numerado, sin duplicados y con los mismos saldos', async () => {
    const pc1 = await nuevoPC(ana, 'PC recepción');
    const pc2 = await nuevoPC(ana, 'PC gerencia');
    const antes = (await numerosServidor()).length;
    pc1.estado.enLinea = false;
    pc2.estado.enLinea = false;

    const roble1 = await crearTercero(pc1.base, empresa, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'El Roble SAS', tipos: ['cliente'] });
    const roble2 = await crearTercero(pc2.base, empresa, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Distribuciones El Roble SAS', tipos: ['cliente'] });
    expect(roble1).not.toBe(roble2);
    for (const [pc, roble, n] of [[pc1, roble1, 3], [pc2, roble2, 2]] as const) {
      for (let i = 0; i < n; i++) {
        await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-15', concepto: `Venta ${i}`, lineas: [D('130505', '119000', roble), C('413595', '100000'), C('240805', '19000')] });
      }
    }
    // Intento sin conexión: nada se pierde y se registra el intento
    const fallido = await pc1.sync();
    expect(fallido.error).toMatch(/conexión/);
    expect((await estadoSincronizacion(pc1.base, empresa)).pendientes).toBe(4);

    pc1.estado.enLinea = true;
    pc2.estado.enLinea = true;
    const r1 = await pc1.sync();
    const r2 = await pc2.sync();
    expect(r1).toMatchObject({ contabilizados: 3, tercerosRegistrados: 1, rechazados: 0, error: null });
    expect(r2).toMatchObject({ contabilizados: 2, tercerosRegistrados: 1, rechazados: 0, error: null });
    await pc1.sync(); // trae lo de PC2

    const numeros = await numerosServidor();
    expect(numeros).toHaveLength(antes + 5);
    expect(new Set(numeros).size).toBe(numeros.length); // sin duplicados
    // PC2 adoptó el id del tercero del servidor (el de PC1) y ya no tiene el suyo
    const t2 = await tercerosLocales(pc2.base, empresa);
    expect(t2.map((t) => t.id)).toEqual([roble1]);
    expect(t2[0]!.nombre).toBe('Distribuciones El Roble SAS'); // gana el último confirmado
    const lineasPc2 = await leerComprobantes(pc2.base, empresa, { estados: ['contabilizado'] });
    expect(lineasPc2.flatMap((c) => c.lineas.map((l) => l.terceroId)).filter(Boolean).every((t) => t === roble1)).toBe(true);

    // Los dos PC ven exactamente lo mismo
    const rango = { desde: '2026-01-01', hasta: '2026-12-31' };
    const bp1 = await balancePruebaLocal(pc1.base, empresa, rango);
    const bp2 = await balancePruebaLocal(pc2.base, empresa, rango);
    expect(bp1.cuadra).toBe(true);
    expect(bp1.filas).toEqual(bp2.filas);
    const [saldoServidor] = await enServidor<{ s: string }>(db, ana,
      `select sum(debito - credito)::text as s from public.lineas where empresa_id = $1 and cuenta = '130505'`, [empresa]);
    expect(bp1.filas.find((f) => f.codigo === '130505')!.saldoFinal).toBe($(saldoServidor!.s));
  });
});

describe('sección 13: cortes de red y de energía', () => {
  it('la red se cae después de que el servidor contabilizó pero antes de recibir la respuesta: no se duplica', async () => {
    const pc = await nuevoPC(ana, 'PC corte');
    const { id } = await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-16', concepto: 'Corte', lineas: [D('519595', '1000'), C('111005', '1000')] });
    pc.estado.perderSiguienteRespuesta = true;
    expect((await pc.sync()).error).toMatch(/cortó/);
    expect((await leerComprobantes(pc.base, empresa)).find((c) => c.id === id)!.estado).toBe('pendiente_sync');
    const r = await pc.sync();
    // El reintento entra por la idempotencia del servidor: contabilizado, sin rechazos.
    expect(r).toMatchObject({ error: null, contabilizados: 1, rechazados: 0 });
    const c = (await leerComprobantes(pc.base, empresa)).find((x) => x.id === id)!;
    expect(c.estado).toBe('contabilizado');
    const [{ n }] = await enServidor<{ n: number }>(db, ana, 'select count(*)::int as n from public.comprobantes where id = $1', [id]) as [{ n: number }];
    expect(n).toBe(1);
  });

  it('apagón mientras se aplica una página de cambios: la copia local no queda a medias y la siguiente sincronización completa', async () => {
    const pc = await nuevoPC(ana, 'PC apagón');
    const ref = await nuevoPC(ana, 'PC referencia');
    await crearComprobante(ref.base, empresa, { tipo: 'CG', fecha: '2026-09-17', concepto: 'Para el apagón', lineas: [D('519595', '777'), C('111005', '777')] });
    await ref.sync();
    const [antes] = await pc.base.consultar<{ ultima_seq: number }>('select ultima_seq from estado_sync where empresa_id = ?', [empresa]);
    const nComp = (await leerComprobantes(pc.base, empresa)).length;
    (pc.base as ReturnType<typeof baseNode>).fallarEnSentencia = 1; // a mitad del lote
    await expect(pc.sync()).rejects.toThrow(/APAGÓN/);
    const [despues] = await pc.base.consultar<{ ultima_seq: number }>('select ultima_seq from estado_sync where empresa_id = ?', [empresa]);
    expect(despues).toEqual(antes);
    expect(await leerComprobantes(pc.base, empresa)).toHaveLength(nComp);
    await pc.sync();
    expect(await leerComprobantes(pc.base, empresa)).toHaveLength(nComp + 1);
  });

  it('apagón real: el proceso muere a mitad de una transacción y la base sigue íntegra con lo confirmado', () => {
    const ruta = join(mkdtempSync(join(tmpdir(), 'contafi-')), 'local.db');
    const hijo = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(ruta)});
      db.exec("pragma journal_mode = wal; pragma synchronous = full; create table t (v integer);");
      db.exec("begin immediate; insert into t values (1); commit;");
      db.exec("begin immediate");
      for (let i = 0; i < 10000; i++) db.prepare("insert into t values (?)").run(i);
      process.kill(process.pid, 'SIGKILL');
    `;
    const r = spawnSync(process.execPath, ['-e', hijo]);
    expect(r.signal).toBe('SIGKILL');
    const db = new DatabaseSync(ruta);
    expect(db.prepare('pragma integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.prepare('select count(*) as n from t').get()).toEqual({ n: 1 });
  });

  it('reinstalación: un PC nuevo descarga todo y queda igual al original', async () => {
    const original = await nuevoPC(ana, 'PC original');
    await original.sync();
    const nuevo = await nuevoPC(ana, 'PC reinstalado');
    const rango = { desde: '2026-01-01', hasta: '2026-12-31' };
    expect((await balancePruebaLocal(nuevo.base, empresa, rango)).filas).toEqual((await balancePruebaLocal(original.base, empresa, rango)).filas);
    expect((await leerComprobantes(nuevo.base, empresa)).map((c) => c.numero).sort())
      .toEqual((await leerComprobantes(original.base, empresa)).map((c) => c.numero).sort());
  });
});

describe('flujos con el servidor', () => {
  it('período cerrado mientras el PC estaba sin conexión: el comprobante queda rechazado con el motivo, y el cierre llega al PC', async () => {
    const pc = await nuevoPC(ana, 'PC cierre');
    pc.estado.enLinea = false;
    const { id } = await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-07-20', concepto: 'Tarde', lineas: [D('519595', '50'), C('111005', '50')] });
    await enServidor(db, ana, `select public.cambiar_estado_periodo($1, 2026, 7, 'cerrado')`, [empresa]);
    pc.estado.enLinea = true;
    expect((await pc.sync()).rechazados).toBe(1);
    const c = (await leerComprobantes(pc.base, empresa)).find((x) => x.id === id)!;
    expect(c).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'PERIODO_CERRADO' }] });
    expect(await estadoSincronizacion(pc.base, empresa)).toMatchObject({ rechazados: 1, pendientes: 0 });
    await expect(crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-07-21', concepto: 'Otro', lineas: [D('519595', '1'), C('111005', '1')] }))
      .rejects.toThrow(/cerrado/);
  });

  it('el auxiliar deja el comprobante por aprobar; cuando el contador lo aprueba, llega con número', async () => {
    const pc = await nuevoPC(carla, 'PC auxiliar');
    const { id } = await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-18', concepto: 'Caja menor', lineas: [D('519530', '35000'), C('110510', '35000')] });
    expect((await pc.sync()).porAprobar).toBe(1);
    expect((await leerComprobantes(pc.base, empresa)).find((c) => c.id === id)!.estado).toBe('por_aprobar');
    await enServidor(db, ana, 'select public.aprobar_comprobante($1)', [id]);
    await pc.sync();
    expect((await leerComprobantes(pc.base, empresa)).find((c) => c.id === id)).toMatchObject({ estado: 'contabilizado', numero: expect.stringMatching(/^CG-\d{6}$/) });
  });

  it('una anulación hecha en otro equipo llega con el reverso y el saldo neto en cero', async () => {
    const pc = await nuevoPC(ana, 'PC anulación');
    const { id } = await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-19', concepto: 'Error', lineas: [D('513530', '88000'), C('111005', '88000')] });
    await pc.sync();
    await enServidor(db, ana, `select public.anular_comprobante($1, 'Duplicado')`, [id]);
    await pc.sync();
    const todos = await leerComprobantes(pc.base, empresa);
    expect(todos.find((c) => c.id === id)!.estado).toBe('anulado');
    expect(todos.find((c) => c.reversaDe === id)!.estado).toBe('contabilizado');
    const bp = await balancePruebaLocal(pc.base, empresa, { desde: '2026-09-19', hasta: '2026-09-19' });
    expect(bp.filas.find((f) => f.codigo === '513530')!.saldoFinal).toBe(0n);
  });

  it('los saldos sin conexión se marcan como provisionales', async () => {
    const pc = await nuevoPC(ana, 'PC provisional');
    pc.estado.enLinea = false;
    await crearComprobante(pc.base, empresa, { tipo: 'CG', fecha: '2026-09-20', concepto: 'Sin red', lineas: [D('519595', '10'), C('111005', '10')] });
    const oficial = await balancePruebaLocal(pc.base, empresa, { desde: '2026-09-20', hasta: '2026-09-20' });
    const provisional = await balancePruebaLocal(pc.base, empresa, { desde: '2026-09-20', hasta: '2026-09-20' }, { incluirPendientes: true });
    expect(oficial.provisional).toBe(false);
    expect(provisional.provisional).toBe(true);
    expect(provisional.ultimaSincronizacion).not.toBeNull();
    expect(provisional.totalDebitos - oficial.totalDebitos).toBe($('10'));
  });

  it('aviso de más de 7 días sin sincronizar', async () => {
    const pc = await nuevoPC(ana, 'PC viejo');
    const en8dias = new Date(Date.now() + 8 * 86_400_000);
    expect((await estadoSincronizacion(pc.base, empresa)).alerta).toBe(false);
    expect((await estadoSincronizacion(pc.base, empresa, en8dias))).toMatchObject({ alerta: true, diasSinSincronizar: 8 });
  });
});

describe('transporte HTTP', () => {
  const lote = { version_protocolo: 1 as const, empresa_id: randomUUID(), dispositivo: { id: randomUUID(), nombre: 'x', version_app: '1' }, terceros: [], comprobantes: [] };
  it('renueva el token una vez si el servidor responde 401', async () => {
    const tokens: string[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      tokens.push((init.headers as Record<string, string>)['Authorization']!);
      return tokens.length === 1 ? new Response('{}', { status: 401 }) : Response.json({ version_protocolo: 1, terceros: [], resultados: [] });
    }) as typeof fetch;
    const t = transporteHttp({ urlBase: 'https://x', token: async () => 'viejo', renovarToken: async () => 'nuevo', fetch: f });
    await t.enviar(lote);
    expect(tokens).toEqual(['Bearer viejo', 'Bearer nuevo']);
  });
  it('sin red lanza ErrorTransporte con estado 0; errores del servidor conservan código y mensaje', async () => {
    const sinRed = transporteHttp({ urlBase: 'https://x', token: async () => 't', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(sinRed.enviar(lote)).rejects.toMatchObject({ estado: 0, codigo: 'SIN_CONEXION' });
    const con413 = transporteHttp({ urlBase: 'https://x', token: async () => 't',
      fetch: (async () => Response.json({ error: 'LOTE_MUY_GRANDE', mensaje: 'Divida el lote.' }, { status: 413 })) as typeof fetch });
    await expect(con413.enviar(lote)).rejects.toBeInstanceOf(ErrorTransporte);
    await expect(con413.enviar(lote)).rejects.toMatchObject({ estado: 413, codigo: 'LOTE_MUY_GRANDE' });
  });
});

export type { BaseLocal };
