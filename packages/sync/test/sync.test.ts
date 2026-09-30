import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  ErrorAcceso, loteEnvio, obtenerCambios, procesarEnvio, VERSION_PROTOCOLO,
  type ComprobanteSync, type LoteEnvio, type RespuestaCambios,
} from '../src/index.ts';
import { repositorioPglite } from './repositorio-pglite.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
const carla: Sesion = { sub: randomUUID(), email: 'carla@firma.co', aal: 'aal1' };
const beto: Sesion = { sub: randomUUID(), email: 'beto@norte.co', aal: 'aal2' };
const PC = { id: randomUUID(), nombre: 'PC oficina', version_app: '0.1.0' };

let db: PGlite;
let empresa: string;
let tercero: string;

const uno = async <T>(s: Sesion, sql: string, p: unknown[] = []) => (await como<T>(db, s, sql, p))[0]!;

function cg(fecha: string, lineas: [string, string, string][], extra: Partial<ComprobanteSync> = {}): ComprobanteSync {
  const id = randomUUID();
  return {
    id, tipo: 'CG', fecha, concepto: 'Prueba de sincronización', origen: 'manual', clave_idempotencia: `pc1:${id}`,
    lineas: lineas.map(([cuenta, debito, credito]) => ({ cuenta, debito, credito, tercero_id: cuenta === '130505' ? tercero : null })),
    ...extra,
  };
}
const lote = (comprobantes: ComprobanteSync[]): LoteEnvio => ({ version_protocolo: VERSION_PROTOCOLO, empresa_id: empresa, dispositivo: PC, comprobantes });

beforeAll(async () => {
  db = await crearBaseDePrueba();
  for (const s of [ana, carla, beto]) await registrarUsuario(db, s.sub!, s.email!);
  const firma = (await uno<{ f: string }>(ana, `select public.crear_firma('Ortiz Contadores') as f`)).f;
  empresa = (await uno<{ e: string }>(ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma])).e;
  tercero = (await uno<{ id: string }>(ana, `insert into public.terceros (empresa_id, tipo_doc, numero, nombre) values ($1, '31', '830945221', 'El Roble') returning id`, [empresa])).id;
  const inv = await uno<{ r: { token: string } }>(ana, `select public.invitar_usuario($1, 'carla@firma.co', 'miembro', $2::jsonb) as r`,
    [firma, JSON.stringify([{ empresa_id: empresa, rol: 'AuxContable' }])]);
  await como(db, carla, 'select public.aceptar_invitacion($1)', [inv.r.token]);
  await uno(beto, `select public.crear_firma('Norte') as f`);
});

describe('envío de la cola de salida (sección 9.2)', () => {
  const repo = () => repositorioPglite(db, ana);

  it('contabiliza en orden y asigna los números oficiales', async () => {
    const r = await procesarEnvio(repo(), lote([
      cg('2026-09-01', [['111005', '50000000', '0'], ['310505', '0', '50000000']]),
      cg('2026-09-02', [['130505', '119000', '0'], ['413595', '0', '100000'], ['240805', '0', '19000']]),
    ]));
    expect(r.resultados.map((x) => [x.estado, x.numero])).toEqual([['contabilizado', 'CG-000001'], ['contabilizado', 'CG-000002']]);
  });

  it('un reintento (corte a mitad del envío) no duplica', async () => {
    const l = lote([cg('2026-09-03', [['519595', '80000', '0'], ['111005', '0', '80000']])]);
    const primero = await procesarEnvio(repo(), l);
    const segundo = await procesarEnvio(repo(), l);
    expect(segundo.resultados[0]).toMatchObject({ id: primero.resultados[0]!.id, numero: 'CG-000003', repetido: true });
  });

  it('el motor rechaza antes de tocar la base, con el detalle por línea, y no deja huecos en la numeración', async () => {
    const r = await procesarEnvio(repo(), lote([
      cg('2026-09-04', [['111005', '100', '0'], ['310505', '0', '99']]),
      cg('2026-09-04', [['130505', '100', '0'], ['1105', '0', '100']]),
      cg('2026-09-04', [['519595', '5', '0'], ['111005', '0', '5']]),
    ]));
    expect(r.resultados[0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'DESCUADRADO' }] });
    expect(r.resultados[1]!.errores).toContainEqual(expect.objectContaining({ codigo: 'CUENTA_NO_ACEPTA_MOVIMIENTO', linea: 1 }));
    expect(r.resultados[2]).toMatchObject({ estado: 'contabilizado', numero: 'CG-000004' });
  });

  it('si el período se cerró después, el reintento devuelve lo que ya se había contabilizado', async () => {
    const c = cg('2026-08-15', [['519595', '1000', '0'], ['111005', '0', '1000']]);
    const antes = await procesarEnvio(repo(), lote([c]));
    await como(db, ana, `select public.cambiar_estado_periodo($1, 2026, 8, 'cerrado')`, [empresa]);
    const despues = await procesarEnvio(repo(), lote([c]));
    expect(despues.resultados[0]).toMatchObject({ estado: 'contabilizado', numero: antes.resultados[0]!.numero, repetido: true });
    const nuevo = await procesarEnvio(repo(), lote([cg('2026-08-16', [['519595', '1', '0'], ['111005', '0', '1']])]));
    expect(nuevo.resultados[0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'PERIODO_CERRADO' }] });
  });

  it('el auxiliar contable deja borradores sin número', async () => {
    const r = await procesarEnvio(repositorioPglite(db, carla), lote([cg('2026-09-05', [['519595', '7000', '0'], ['111005', '0', '7000']])]));
    expect(r.resultados[0]).toMatchObject({ estado: 'borrador', numero: null });
  });

  it('un usuario de otra firma recibe error de acceso', async () => {
    await expect(procesarEnvio(repositorioPglite(db, beto), lote([cg('2026-09-05', [['519595', '1', '0'], ['111005', '0', '1']])])))
      .rejects.toThrow(ErrorAcceso);
  });

  it('registra el dispositivo y la hora de la última sincronización', async () => {
    const d = await uno<{ nombre: string; ultima_sync: Date | null }>(ana, 'select nombre, ultima_sync from public.dispositivos where id = $1', [PC.id]);
    expect(d.nombre).toBe('PC oficina');
    expect(d.ultima_sync).not.toBeNull();
  });

  it('montos de 16 dígitos viajan sin perder un centavo', async () => {
    const grande = '9999999999999999.99';
    const r = await procesarEnvio(repo(), lote([cg('2026-09-06', [['111005', grande, '0'], ['310505', '0', grande]])]));
    const [l] = await como<{ d: string }>(db, ana, `select debito::text as d from public.lineas where comprobante_id = $1 and debito > 0`, [r.resultados[0]!.id]);
    expect(l!.d).toBe(grande);
  });
});

describe('protocolo', () => {
  const base = () => lote([cg('2026-09-01', [['111005', '1', '0'], ['310505', '0', '1']])]);
  it('acepta un lote válido', () => {
    expect(loteEnvio.safeParse(base()).success).toBe(true);
  });
  it('rechaza montos como number, con 3 decimales o negativos', () => {
    for (const debito of [1 as unknown as string, '1.005', '-1', '1e5']) {
      const l = base();
      l.comprobantes[0]!.lineas[0]!.debito = debito;
      expect(loteEnvio.safeParse(l).success, String(debito)).toBe(false);
    }
  });
  it('rechaza fechas inválidas, versiones de protocolo desconocidas y claves cortas', () => {
    const a = base(); a.comprobantes[0]!.fecha = '2026-02-30';
    const b = { ...base(), version_protocolo: 2 };
    const c = base(); c.comprobantes[0]!.clave_idempotencia = 'x';
    for (const l of [a, b, c]) expect(loteEnvio.safeParse(l).success).toBe(false);
  });
});

describe('recepción incremental (sección 9.3)', () => {
  it('la descarga inicial se pagina y trae el estado actual de cada registro', async () => {
    const repo = repositorioPglite(db, ana);
    let desde = 0;
    const todo: RespuestaCambios['registros'][] = [];
    let paginas = 0;
    for (;;) {
      const r = await obtenerCambios(repo, { empresa_id: empresa, desde, limite: 50 });
      todo.push(r.registros);
      paginas++;
      expect(r.ultima_seq).toBeGreaterThanOrEqual(desde);
      desde = r.ultima_seq;
      if (!r.hay_mas) break;
    }
    expect(paginas).toBeGreaterThan(2);
    const cuentas = new Set(todo.flatMap((p) => (p.cuentas ?? []).map((c) => c['codigo'])));
    expect(cuentas.size).toBe(124); // toda la plantilla del PUC
    expect(todo.flatMap((p) => p.tipos_comprobante ?? [])).toHaveLength(9);
  });

  it('después solo llega lo nuevo, con las líneas y los montos como texto', async () => {
    const repo = repositorioPglite(db, ana);
    let desde = 0;
    for (let r = await obtenerCambios(repo, { empresa_id: empresa, desde, limite: 1000 }); ; r = await obtenerCambios(repo, { empresa_id: empresa, desde, limite: 1000 })) {
      desde = r.ultima_seq;
      if (!r.hay_mas) break;
    }
    const nuevo = cg('2026-09-20', [['130505', '1190.50', '0'], ['413595', '0', '1190.50']]);
    await procesarEnvio(repo, lote([nuevo]));
    const r = await obtenerCambios(repo, { empresa_id: empresa, desde, limite: 1000 });
    expect(Object.keys(r.registros)).toEqual(['comprobantes']);
    const [c] = r.registros.comprobantes!;
    expect(c).toMatchObject({ id: nuevo.id, estado: 'contabilizado', numero: expect.stringMatching(/^CG-/) });
    expect(c!['lineas']).toEqual([
      expect.objectContaining({ orden: 1, cuenta: '130505', debito: '1190.50', credito: '0.00', tercero_id: tercero }),
      expect.objectContaining({ orden: 2, cuenta: '413595', debito: '0.00', credito: '1190.50' }),
    ]);
    // Sin cambios nuevos: respuesta vacía y la misma secuencia
    const vacio = await obtenerCambios(repo, { empresa_id: empresa, desde: r.ultima_seq, limite: 1000 });
    expect(vacio).toMatchObject({ registros: {}, ultima_seq: r.ultima_seq, hay_mas: false });
  });

  it('un usuario sin acceso a la empresa no recibe cambios', async () => {
    await expect(obtenerCambios(repositorioPglite(db, beto), { empresa_id: empresa, desde: 0, limite: 10 })).rejects.toThrow(ErrorAcceso);
  });

  it('dos usuarios pueden compartir el mismo PC', async () => {
    const filas = await como<{ usuario_id: string }>(db, carla, 'select usuario_id from public.dispositivos where id = $1', [PC.id]);
    expect(filas.map((f) => f.usuario_id)).toEqual([carla.sub]); // cada uno ve solo su registro
  });
});
