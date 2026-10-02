import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { plantillaCompletaPuc } from '@contafi/shared';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  ErrorAcceso, ErrorSuscripcion, loteEnvio, obtenerCambios, procesarEnvio, VERSION_PROTOCOLO,
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
const lote = (comprobantes: ComprobanteSync[], terceros: LoteEnvio['terceros'] = []): LoteEnvio =>
  ({ version_protocolo: VERSION_PROTOCOLO, empresa_id: empresa, dispositivo: PC, cuentas: [], reglas: [], terceros, productos: [], comprobantes });

const nuevoTercero = (numero: string, dv: number | null, nombre: string): LoteEnvio['terceros'][number] =>
  ({ id: randomUUID(), tipo_doc: '31', numero, dv, nombre, tipos: ['proveedor'], responsabilidades: [], activo: true });

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
    expect(segundo.resultados[0]).toMatchObject({ id: primero.resultados[0]!.id, id_servidor: primero.resultados[0]!.id, numero: 'CG-000003', repetido: true });
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

describe('terceros creados sin conexión', () => {
  const repo = () => repositorioPglite(db, ana);
  const conTercero = (t: string) => cg('2026-09-10', [['519595', '5000', '0'], ['220505', '0', '5000']]).lineas.map((l) => ({ ...l, tercero_id: t }));

  it('registra el tercero y el comprobante que lo usa en el mismo lote', async () => {
    const t = nuevoTercero('901223556', 9, 'Suministros del Norte');
    const c = { ...cg('2026-09-10', []), lineas: conTercero(t.id) };
    const r = await procesarEnvio(repo(), lote([c], [t]));
    expect(r.terceros).toEqual([{ id: t.id, id_servidor: t.id, estado: 'registrado', errores: [] }]);
    expect(r.resultados[0]!.estado).toBe('contabilizado');
  });

  it('dos PC crean el mismo NIT: el segundo recibe el id del servidor y su comprobante se reescribe', async () => {
    const pc1 = nuevoTercero('860034313', 7, 'Davivienda');
    await procesarEnvio(repo(), lote([], [pc1]));
    const pc2 = nuevoTercero('860034313', 7, 'Banco Davivienda S.A.');
    const c = { ...cg('2026-09-11', []), lineas: conTercero(pc2.id) };
    const r = await procesarEnvio(repo(), lote([c], [pc2]));
    expect(r.terceros[0]).toMatchObject({ id: pc2.id, id_servidor: pc1.id, estado: 'registrado' });
    expect(r.resultados[0]!.estado).toBe('contabilizado');
    const usados = await como<{ t: string }>(db, ana, 'select distinct tercero_id::text as t from public.lineas where comprobante_id = $1', [c.id]);
    expect(usados).toEqual([{ t: pc1.id }]);
    // Gana el último cambio confirmado; el anterior queda en auditoría
    const [actual] = await como<{ nombre: string }>(db, ana, 'select nombre from public.terceros where id = $1', [pc1.id]);
    expect(actual!.nombre).toBe('Banco Davivienda S.A.');
    const [aud] = await como<{ antes: { nombre: string } }>(db, ana,
      `select antes from public.auditoria where tabla = 'terceros' and registro_id = $1 and accion = 'UPDATE' order by id desc limit 1`, [pc1.id]);
    expect(aud!.antes.nombre).toBe('Davivienda');
  });

  it('un NIT con DV errado se rechaza, y también los comprobantes que lo usan', async () => {
    const malo = nuevoTercero('830945221', 3, 'El Roble (DV del prototipo)');
    const c = { ...cg('2026-09-12', []), lineas: conTercero(malo.id) };
    const r = await procesarEnvio(repo(), lote([c], [malo]));
    expect(r.terceros[0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'DV_INVALIDO' }] });
    expect(r.resultados[0]!.errores).toContainEqual(expect.objectContaining({ codigo: 'TERCERO_RECHAZADO' }));
  });

  it('un usuario sin permiso de crear no registra terceros', async () => {
    await expect(procesarEnvio(repositorioPglite(db, beto), lote([], [nuevoTercero('800197268', 4, 'DIAN')]))).rejects.toThrow(ErrorAcceso);
  });
});

describe('mismo documento enviado desde dos PC con distinto id', () => {
  it('el segundo recibe el id del servidor para descartar su copia', async () => {
    const pc1 = cg('2026-09-13', [['519595', '300', '0'], ['111005', '0', '300']], { clave_idempotencia: 'dian:empresa:CUFE-ABC' });
    const pc2 = { ...pc1, id: randomUUID() };
    const r1 = await procesarEnvio(repositorioPglite(db, ana), lote([pc1]));
    const r2 = await procesarEnvio(repositorioPglite(db, ana), lote([pc2]));
    expect(r1.resultados[0]).toMatchObject({ id: pc1.id, id_servidor: pc1.id, repetido: false });
    expect(r2.resultados[0]).toMatchObject({ id: pc2.id, id_servidor: pc1.id, repetido: true, numero: r1.resultados[0]!.numero });
  });
});

describe('productos creados sin conexión', () => {
  it('el producto viaja antes que la factura; el mismo código desde otro PC se unifica', async () => {
    const repo = repositorioPglite(db, ana);
    const prod = (id: string) => ({ id, codigo: 'RT-9', nombre: 'Router', tipo: 'producto' as const, unidad: 'UND', cuenta_inventario: '143505', iva_tipo: 'gravado' as const, iva_tarifa_ppm: 190000, activo: true });
    const p1 = prod(randomUUID());
    const compra = { ...cg('2026-09-14', []), lineas: [
      { cuenta: '143505', debito: '500000', credito: '0', producto_id: p1.id, cantidad: '5' },
      { cuenta: '111005', debito: '0', credito: '500000' },
    ] };
    const r1 = await procesarEnvio(repo, { ...lote([compra]), productos: [p1] });
    expect(r1.productos).toEqual([{ id: p1.id, id_servidor: p1.id, estado: 'registrado', errores: [] }]);
    expect(r1.resultados[0]!.estado).toBe('contabilizado');
    const p2 = prod(randomUUID());
    const venta = { ...cg('2026-09-15', []), lineas: [
      { cuenta: '613595', debito: '100000', credito: '0' },
      { cuenta: '143505', debito: '0', credito: '100000', producto_id: p2.id, cantidad: '1' },
    ] };
    const r2 = await procesarEnvio(repo, { ...lote([venta]), productos: [p2] });
    expect(r2.productos[0]).toMatchObject({ id: p2.id, id_servidor: p1.id });
    expect(r2.resultados[0]!.estado).toBe('contabilizado');
    const [l] = await como<{ p: string }>(db, ana, 'select producto_id::text as p from public.lineas where comprobante_id = $1 and producto_id is not null', [venta.id]);
    expect(l!.p).toBe(p1.id);
  });
});

describe('cuentas creadas sin conexión', () => {
  const cuenta = (codigo: string, nombre: string) => ({ codigo, nombre, exige_tercero: false, exige_centro_costo: false, activa: true });

  it('la cuenta viaja antes que el comprobante que la usa', async () => {
    const r = await procesarEnvio(repositorioPglite(db, ana), {
      ...lote([cg('2026-09-16', [['11200501', '700000', '0'], ['310505', '0', '700000']])]),
      cuentas: [cuenta('11200501', 'Davivienda ahorros 9981')],
    });
    expect(r.cuentas).toEqual([{ codigo: '11200501', estado: 'registrado', errores: [] }]);
    expect(r.resultados[0]!.estado).toBe('contabilizado');
  });

  it('una cuenta rechazada (o sin permiso) no detiene el lote; sus comprobantes se rechazan con motivo', async () => {
    const r = await procesarEnvio(repositorioPglite(db, ana), {
      ...lote([cg('2026-09-16', [['13809901', '1', '0'], ['310505', '0', '1']]), cg('2026-09-16', [['519595', '1', '0'], ['111005', '0', '1']])]),
      cuentas: [cuenta('13809901', 'Sin padre')],
    });
    expect(r.cuentas![0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'SIN_CUENTA_PADRE' }], actual: null });
    expect(r.resultados.map((x) => x.estado)).toEqual(['rechazado', 'contabilizado']);
    const aux = await procesarEnvio(repositorioPglite(db, carla), { ...lote([]), cuentas: [cuenta('11200502', 'Del auxiliar')] });
    expect(aux.cuentas![0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'SIN_PERMISO' }] });
    // Una edición rechazada devuelve la cuenta como está en el servidor, para deshacerla en el PC.
    const editar = await procesarEnvio(repositorioPglite(db, carla), { ...lote([]), cuentas: [cuenta('11200501', 'Renombrada por el auxiliar')] });
    expect(editar.cuentas![0]).toMatchObject({ estado: 'rechazado', actual: { codigo: '11200501', nombre: 'Davivienda ahorros 9981' } });
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
    expect(cuentas.size).toBe(plantillaCompletaPuc().length + 1); // toda la plantilla del PUC y la auxiliar creada sin conexión
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

describe('reglas aprendidas por proveedor (importación DIAN)', () => {
  it('viajan en el lote; null no borra lo que aprendió otro PC; la cuenta debe ser auxiliar', async () => {
    const repo = repositorioPglite(db, ana);
    const r1 = await procesarEnvio(repo, { ...lote([]), reglas: [{ nit: '901223556', cuenta: '519595', retenciones: null }] });
    expect(r1.reglas).toEqual([{ nit: '901223556', estado: 'registrado', errores: [] }]);
    // Otro PC aprendió solo las retenciones de ese proveedor: la cuenta se conserva
    await procesarEnvio(repo, { ...lote([]), reglas: [{ nit: '901223556', cuenta: null, retenciones: ['RF-COMPRAS'] }] });
    expect(await como(db, ana, `select cuenta, retenciones from public.reglas_proveedor where nit = '901223556'`))
      .toEqual([{ cuenta: '519595', retenciones: ['RF-COMPRAS'] }]);
    const mala = await procesarEnvio(repo, { ...lote([]), reglas: [{ nit: '830945221', cuenta: '1105', retenciones: [] }] });
    expect(mala.reglas![0]).toMatchObject({ estado: 'rechazado', errores: [{ codigo: 'CUENTA_INVALIDA' }] });
    // Llegan a los demás PC como cambios
    const c = await obtenerCambios(repo, { empresa_id: empresa, desde: 0, limite: 1000 });
    expect(c.registros.reglas_proveedor).toEqual([{ nit: '901223556', cuenta: '519595', retenciones: ['RF-COMPRAS'] }]);
  });
});

describe('suscripción vencida (modo consulta)', () => {
  it('el lote falla entero con un mensaje claro y nada se rechaza; al renovar, entra', async () => {
    const repo = repositorioPglite(db, ana);
    const l = lote([cg('2026-09-20', [['519595', '1000', '0'], ['111005', '0', '1000']])]);
    await db.query(`update public.firmas set pagado_hasta = current_date - 30 where id = (select firma_id from public.empresas where id = $1)`, [empresa]);
    await expect(procesarEnvio(repo, l)).rejects.toThrow(ErrorSuscripcion);
    await expect(procesarEnvio(repo, l)).rejects.toThrow(/modo consulta/);
    expect((await obtenerCambios(repo, { empresa_id: empresa, desde: 0, limite: 10 })).registros).toBeDefined(); // leer sí
    await db.query(`update public.firmas set pagado_hasta = current_date + 30 where id = (select firma_id from public.empresas where id = $1)`, [empresa]);
    expect((await procesarEnvio(repo, l)).resultados[0]!.estado).toBe('contabilizado');
  });
});
