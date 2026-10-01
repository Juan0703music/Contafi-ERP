import { calcularDV, hoyBogota, periodoDe, type Centavos, type FechaISO } from '@contafi/shared';
import {
  ErrorMotor, balancePrueba, contextoDesdeCuentas, numeroLocal, validarComprobante,
  type BalancePrueba, type Comprobante, type ContextoContable, type Cuenta, type EstadoComprobante,
  type Linea, type OrigenComprobante,
} from '@contafi/motor';
import { terceroSync, type TerceroSync } from '@contafi/sync';
import { s, type BaseLocal, type Sentencia } from './base.ts';

/** Estados locales. `por_aprobar` = el servidor lo tiene como borrador esperando a un contador. */
export type EstadoLocal = 'pendiente_sync' | 'por_aprobar' | 'contabilizado' | 'anulado' | 'rechazado';

export interface ComprobanteLocal extends Omit<Comprobante, 'estado'> {
  estado: EstadoLocal;
  numeroLocal: string | null;
  errores: { codigo: string; mensaje: string; linea?: number }[];
}

export class ErrorLocal extends Error {
  override name = 'ErrorLocal';
  readonly codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const ahora = () => new Date().toISOString();
const nuevoId = () => globalThis.crypto.randomUUID();

// ------------------------------------------------------------------ empresas y catálogos

export interface EmpresaLocal {
  id: string;
  firma_id: string;
  nit: string;
  dv: number | null;
  razon_social: string;
}

/** Guarda la lista de empresas a las que el usuario tiene acceso (se obtiene en línea al iniciar sesión). */
export async function guardarEmpresas(base: BaseLocal, empresas: readonly EmpresaLocal[]): Promise<void> {
  const t = ahora();
  await base.lote(empresas.map((e) => s(
    `insert into empresas (id, firma_id, nit, dv, razon_social, actualizado_en) values (?, ?, ?, ?, ?, ?)
     on conflict (id) do update set firma_id = excluded.firma_id, nit = excluded.nit, dv = excluded.dv,
       razon_social = excluded.razon_social, actualizado_en = excluded.actualizado_en`,
    e.id, e.firma_id, e.nit, e.dv, e.razon_social, t)));
}

export async function empresasLocales(base: BaseLocal): Promise<EmpresaLocal[]> {
  return base.consultar<EmpresaLocal>('select id, firma_id, nit, dv, razon_social from empresas order by razon_social');
}

export async function cuentasLocales(base: BaseLocal, empresa: string): Promise<Cuenta[]> {
  const filas = await base.consultar<{ codigo: string; nombre: string; naturaleza: 'D' | 'C'; acepta_movimiento: number; exige_tercero: number; exige_centro_costo: number; activa: number }>(
    'select codigo, nombre, naturaleza, acepta_movimiento, exige_tercero, exige_centro_costo, activa from cuentas where empresa_id = ? order by codigo', [empresa]);
  return filas.map((c) => ({
    codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza, aceptaMovimiento: !!c.acepta_movimiento,
    exigeTercero: !!c.exige_tercero, exigeCentroCosto: !!c.exige_centro_costo, activa: !!c.activa,
  }));
}

export async function tiposComprobante(base: BaseLocal, empresa: string): Promise<{ codigo: string; nombre: string }[]> {
  return base.consultar('select codigo, nombre from tipos_comprobante where empresa_id = ? order by codigo', [empresa]);
}

export async function contextoLocal(base: BaseLocal, empresa: string): Promise<ContextoContable> {
  const cerrados = await base.consultar<{ p: string }>(
    `select printf('%04d-%02d', anio, mes) as p from periodos where empresa_id = ? and estado = 'cerrado'`, [empresa]);
  return contextoDesdeCuentas(await cuentasLocales(base, empresa), cerrados.map((x) => x.p));
}

// ------------------------------------------------------------------ terceros

export type DatosTercero = Omit<TerceroSync, 'id' | 'tipos' | 'responsabilidades' | 'activo'>
  & Partial<Pick<TerceroSync, 'tipos' | 'responsabilidades' | 'activo'>>;

function validarTercero(t: TerceroSync): void {
  const r = terceroSync.safeParse(t);
  if (!r.success) throw new ErrorLocal('DATOS_INVALIDOS', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (t.tipo_doc === '31' && calcularDV(t.numero) !== t.dv) {
    throw new ErrorLocal('DV_INVALIDO', `El dígito de verificación del NIT ${t.numero} es ${calcularDV(t.numero)}.`);
  }
}

function sentenciasTercero(empresa: string, t: TerceroSync, crear: boolean): Sentencia[] {
  const valores = [t.tipo_doc, t.numero, t.dv ?? null, t.nombre, JSON.stringify(t.tipos), JSON.stringify(t.responsabilidades),
    t.direccion ?? null, t.municipio ?? null, t.correo ?? null, t.activo] as const;
  return [
    crear
      ? s(`insert into terceros (id, empresa_id, tipo_doc, numero, dv, nombre, tipos, responsabilidades, direccion, municipio, correo, activo)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, t.id, empresa, ...valores)
      : s(`update terceros set tipo_doc = ?, numero = ?, dv = ?, nombre = ?, tipos = ?, responsabilidades = ?,
             direccion = ?, municipio = ?, correo = ?, activo = ?, errores_sync = null where id = ?`, ...valores, t.id),
    s(`insert into cola_salida (empresa_id, tipo, registro_id, creado_en) values (?, 'tercero', ?, ?)
       on conflict (empresa_id, tipo, registro_id) do nothing`, empresa, t.id, ahora()),
  ];
}

/** Crea un tercero (funciona sin conexión). Devuelve su id. */
export async function crearTercero(base: BaseLocal, empresa: string, datos: DatosTercero): Promise<string> {
  const t: TerceroSync = { tipos: [], responsabilidades: [], activo: true, ...datos, id: nuevoId() };
  validarTercero(t);
  const [dup] = await base.consultar<{ nombre: string }>(
    'select nombre from terceros where empresa_id = ? and tipo_doc = ? and numero = ?', [empresa, t.tipo_doc, t.numero]);
  if (dup) throw new ErrorLocal('TERCERO_DUPLICADO', `Ya existe un tercero con ese documento: ${dup.nombre}.`);
  await base.lote(sentenciasTercero(empresa, t, true));
  return t.id;
}

export async function editarTercero(base: BaseLocal, id: string, datos: DatosTercero): Promise<void> {
  const [actual] = await base.consultar<{ empresa_id: string }>('select empresa_id from terceros where id = ?', [id]);
  if (!actual) throw new ErrorLocal('NO_EXISTE', 'El tercero no existe.');
  const t: TerceroSync = { tipos: [], responsabilidades: [], activo: true, ...datos, id };
  validarTercero(t);
  await base.lote(sentenciasTercero(actual.empresa_id, t, false));
}

export interface TerceroLocal extends TerceroSync {
  empresa_id: string;
  errores_sync: string | null;
  pendiente: boolean;
}

export async function tercerosLocales(base: BaseLocal, empresa: string, buscar = ''): Promise<TerceroLocal[]> {
  const filas = await base.consultar<Record<string, unknown>>(
    `select t.*, exists (select 1 from cola_salida c where c.tipo = 'tercero' and c.registro_id = t.id) as pendiente
       from terceros t where t.empresa_id = ? and (? = '' or t.nombre like '%' || ? || '%' or t.numero like ? || '%')
      order by t.nombre limit 500`, [empresa, buscar, buscar, buscar]);
  return filas.map((f) => ({
    id: String(f['id']), empresa_id: String(f['empresa_id']), tipo_doc: String(f['tipo_doc']), numero: String(f['numero']),
    dv: f['dv'] == null ? null : Number(f['dv']), nombre: String(f['nombre']),
    tipos: JSON.parse(String(f['tipos'])), responsabilidades: JSON.parse(String(f['responsabilidades'])),
    direccion: (f['direccion'] as string | null) ?? null, municipio: (f['municipio'] as string | null) ?? null,
    correo: (f['correo'] as string | null) ?? null, activo: !!f['activo'],
    errores_sync: (f['errores_sync'] as string | null) ?? null, pendiente: !!f['pendiente'],
  }));
}

// ------------------------------------------------------------------ comprobantes

export interface DatosComprobante {
  tipo: string;
  fecha: FechaISO;
  concepto: string;
  lineas: Linea[];
  origen?: OrigenComprobante;
  reversaDe?: string | null;
}

/**
 * Crea un comprobante sin necesidad de conexión (sección 9.1): se valida con el motor, se guarda con un
 * número local temporal ("CG-LOCAL-7F3A") y queda en la cola de salida. Todo en una sola transacción.
 */
export async function crearComprobante(
  base: BaseLocal, empresa: string, datos: DatosComprobante,
  opciones: {
    claveBorrador?: string;
    /** Clave de idempotencia propia (p. ej. "dian:<empresa>:<CUFE>" para que dos PC no dupliquen una factura). */
    clave?: string;
    /** Sentencias que deben guardarse en la MISMA transacción que el comprobante. */
    extra?: (id: string) => Sentencia[];
  } = {},
): Promise<{ id: string; numeroLocal: string }> {
  const errores = validarComprobante(datos, await contextoLocal(base, empresa));
  const terceros = [...new Set(datos.lineas.map((l) => l.terceroId).filter((t): t is string => !!t))];
  if (terceros.length) {
    const existentes = new Set((await base.consultar<{ id: string }>(
      `select id from terceros where empresa_id = ? and id in (${terceros.map(() => '?').join(',')})`, [empresa, ...terceros])).map((t) => t.id));
    datos.lineas.forEach((l, i) => {
      if (l.terceroId && !existentes.has(l.terceroId)) errores.push({ codigo: 'DATO_INVALIDO', linea: i, mensaje: `Línea ${i + 1}: el tercero no existe.` });
    });
  }
  if (errores.length) throw new ErrorMotor(errores);

  const id = nuevoId();
  const local = numeroLocal(datos.tipo, id);
  const t = ahora();
  const sentencias: Sentencia[] = [
    s(`insert into comprobantes (id, empresa_id, tipo, numero_local, fecha, concepto, estado, origen, clave_idempotencia, reversa_de, creado_en)
       values (?, ?, ?, ?, ?, ?, 'pendiente_sync', ?, ?, ?, ?)`,
      id, empresa, datos.tipo, local, datos.fecha, datos.concepto.trim(), datos.origen ?? 'manual', opciones.clave ?? `pc:${id}`, datos.reversaDe ?? null, t),
    ...datos.lineas.map((l, i) => s(
      `insert into lineas (comprobante_id, orden, cuenta, tercero_id, centro_costo_id, debito, credito, base_impuesto, nota, producto_id, cantidad)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, i + 1, l.cuenta, l.terceroId ?? null, l.centroCostoId ?? null, l.debito, l.credito, l.base ?? null, l.nota ?? null,
      l.productoId ?? null, l.cantidad ?? null)),
    s(`insert into cola_salida (empresa_id, tipo, registro_id, creado_en) values (?, 'comprobante', ?, ?)`, empresa, id, t),
  ];
  if (opciones.claveBorrador) sentencias.push(s('delete from borradores where clave = ?', opciones.claveBorrador));
  if (opciones.extra) sentencias.push(...opciones.extra(id));
  await base.lote(sentencias);
  return { id, numeroLocal: local };
}

export interface FiltroComprobantes {
  desde?: FechaISO;
  hasta?: FechaISO;
  estados?: EstadoLocal[];
  limite?: number;
}

export async function leerComprobantes(base: BaseLocal, empresa: string, f: FiltroComprobantes = {}): Promise<ComprobanteLocal[]> {
  const cond = ['empresa_id = ?'];
  const p: (string | number)[] = [empresa];
  if (f.desde) { cond.push('fecha >= ?'); p.push(f.desde); }
  if (f.hasta) { cond.push('fecha <= ?'); p.push(f.hasta); }
  if (f.estados?.length) { cond.push(`estado in (${f.estados.map(() => '?').join(',')})`); p.push(...f.estados); }
  const where = cond.join(' and ');
  const limite = f.limite ?? 1_000_000;
  const cabeceras = await base.consultar<Record<string, string | null>>(
    `select id, empresa_id, tipo, numero, numero_local, fecha, concepto, estado, origen, reversa_de, clave_idempotencia, errores
       from comprobantes where ${where} order by fecha, coalesce(numero, numero_local), creado_en limit ${limite}`, p);
  const lineas = await base.consultar<Record<string, string | number | null>>(
    `select comprobante_id, orden, cuenta, tercero_id, centro_costo_id, cast(debito as text) as debito, cast(credito as text) as credito,
            cast(base_impuesto as text) as base_impuesto, nota, producto_id, cast(cantidad as text) as cantidad
       from lineas where comprobante_id in (select id from comprobantes where ${where} order by fecha limit ${limite})
      order by comprobante_id, orden`, p);
  const porComprobante = new Map<string, Linea[]>();
  for (const l of lineas) {
    const lista = porComprobante.get(String(l['comprobante_id'])) ?? [];
    lista.push({
      cuenta: String(l['cuenta']), terceroId: (l['tercero_id'] as string | null) ?? null,
      centroCostoId: (l['centro_costo_id'] as string | null) ?? null,
      debito: BigInt(String(l['debito'])), credito: BigInt(String(l['credito'])),
      base: l['base_impuesto'] == null ? null : BigInt(String(l['base_impuesto'])), nota: (l['nota'] as string | null) ?? null,
      productoId: (l['producto_id'] as string | null) ?? null, cantidad: l['cantidad'] == null ? null : BigInt(String(l['cantidad'])),
    });
    porComprobante.set(String(l['comprobante_id']), lista);
  }
  return cabeceras.map((c) => ({
    id: c['id']!, empresaId: c['empresa_id']!, tipo: c['tipo']!, numero: c['numero'] ?? null, numeroLocal: c['numero_local'] ?? null,
    fecha: c['fecha']!, concepto: c['concepto']!, estado: c['estado'] as EstadoLocal, origen: c['origen'] as OrigenComprobante,
    reversaDe: c['reversa_de'] ?? null, claveIdempotencia: c['clave_idempotencia'] ?? null,
    errores: c['errores'] ? JSON.parse(c['errores']) : [], lineas: porComprobante.get(c['id']!) ?? [],
  }));
}

/**
 * Comprobantes para los reportes. Con `incluirPendientes`, lo creado sin conexión cuenta como si ya
 * estuviera contabilizado (reporte PROVISIONAL, marcado en pantalla "a la última sincronización").
 */
export async function comprobantesParaReportes(
  base: BaseLocal, empresa: string, opciones: { incluirPendientes?: boolean } = {},
): Promise<Comprobante[]> {
  const estados: EstadoLocal[] = opciones.incluirPendientes
    ? ['contabilizado', 'anulado', 'pendiente_sync', 'por_aprobar'] : ['contabilizado', 'anulado'];
  return (await leerComprobantes(base, empresa, { estados })).map((c) => ({
    ...c,
    estado: (c.estado === 'anulado' ? 'anulado' : 'contabilizado') as EstadoComprobante,
  }));
}

export async function balancePruebaLocal(
  base: BaseLocal, empresa: string, rango: { desde: FechaISO; hasta: FechaISO },
  opciones: { incluirPendientes?: boolean; nivelMaximo?: number } = {},
): Promise<BalancePrueba & { provisional: boolean; ultimaSincronizacion: string | null }> {
  const [cuentas, comprobantes, estado] = await Promise.all([
    cuentasLocales(base, empresa), comprobantesParaReportes(base, empresa, opciones), estadoSincronizacion(base, empresa),
  ]);
  const bp = balancePrueba(cuentas, comprobantes, rango, { nivelMaximo: opciones.nivelMaximo });
  return { ...bp, provisional: !!opciones.incluirPendientes && estado.pendientes > 0, ultimaSincronizacion: estado.ultimaSincronizacion };
}

// ------------------------------------------------------------------ estado de sincronización (sección 9.7)

export interface EstadoSincronizacion {
  pendientes: number;
  rechazados: number;
  porAprobar: number;
  tercerosConError: number;
  ultimaSincronizacion: string | null;
  diasSinSincronizar: number | null;
  /** Aviso visible si el equipo lleva más de 7 días sin sincronizar (o nunca lo ha hecho con pendientes). */
  alerta: boolean;
}

export const DIAS_ALERTA_SIN_SYNC = 7;

export async function estadoSincronizacion(base: BaseLocal, empresa: string, momento = new Date()): Promise<EstadoSincronizacion> {
  const [c] = await base.consultar<{ pendientes: number; rechazados: number; por_aprobar: number; terceros_error: number; ultima: string | null }>(
    `select (select count(*) from cola_salida where empresa_id = ?1) as pendientes,
            (select count(*) from comprobantes where empresa_id = ?1 and estado = 'rechazado') as rechazados,
            (select count(*) from comprobantes where empresa_id = ?1 and estado = 'por_aprobar') as por_aprobar,
            (select count(*) from terceros where empresa_id = ?1 and errores_sync is not null) as terceros_error,
            (select ultima_recepcion from estado_sync where empresa_id = ?1) as ultima`, [empresa]);
  const ultima = c?.ultima ?? null;
  const dias = ultima ? Math.floor((momento.getTime() - Date.parse(ultima)) / 86_400_000) : null;
  const pendientes = Number(c?.pendientes ?? 0);
  return {
    pendientes,
    rechazados: Number(c?.rechazados ?? 0),
    porAprobar: Number(c?.por_aprobar ?? 0),
    tercerosConError: Number(c?.terceros_error ?? 0),
    ultimaSincronizacion: ultima,
    diasSinSincronizar: dias,
    alerta: dias === null ? pendientes > 0 : dias > DIAS_ALERTA_SIN_SYNC,
  };
}

// ------------------------------------------------------------------ autoguardado de formularios (sección 9.5)

export async function guardarBorrador(base: BaseLocal, clave: string, contenido: unknown, empresa: string | null = null): Promise<void> {
  const json = JSON.stringify(contenido, (_k, v) => (typeof v === 'bigint' ? { $centavos: v.toString() } : v));
  await base.lote([s(
    `insert into borradores (clave, empresa_id, contenido, actualizado_en) values (?, ?, ?, ?)
     on conflict (clave) do update set contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    clave, empresa, json, ahora())]);
}

export async function leerBorrador<T = unknown>(base: BaseLocal, clave: string): Promise<{ contenido: T; actualizadoEn: string } | null> {
  const [f] = await base.consultar<{ contenido: string; actualizado_en: string }>('select contenido, actualizado_en from borradores where clave = ?', [clave]);
  if (!f) return null;
  const contenido = JSON.parse(f.contenido, (_k, v) => (v && typeof v === 'object' && typeof v.$centavos === 'string' ? BigInt(v.$centavos) : v)) as T;
  return { contenido, actualizadoEn: f.actualizado_en };
}

export async function descartarBorrador(base: BaseLocal, clave: string): Promise<void> {
  await base.lote([s('delete from borradores where clave = ?', clave)]);
}

/** Fecha contable de hoy en Colombia y su período, para valores por defecto en formularios. */
export function hoyContable(): { fecha: FechaISO; periodo: string } {
  const fecha = hoyBogota();
  return { fecha, periodo: periodoDe(fecha) };
}

export type { Centavos };
