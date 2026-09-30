import { aCentavos, aDecimal, esFechaValida } from '@contafi/shared';
import {
  VERSION_PROTOCOLO,
  type ComprobanteSync, type ConsultaCambios, type LoteEnvio, type RespuestaCambios, type RespuestaEnvio, type TerceroSync,
} from '@contafi/sync';
import { s, type BaseLocal, type Sentencia } from './base.ts';

/** Cómo llega la app al servidor. En la app: HTTP (`transporteHttp`); en pruebas: directo a PGlite. */
export interface Transporte {
  enviar(lote: LoteEnvio): Promise<RespuestaEnvio>;
  cambios(q: ConsultaCambios): Promise<RespuestaCambios>;
}

export class ErrorTransporte extends Error {
  override name = 'ErrorTransporte';
  /** 0 = sin conexión o tiempo agotado. */
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export interface Dispositivo {
  id: string;
  nombre: string;
  version_app: string;
}

export interface ResumenSincronizacion {
  enviados: number;
  contabilizados: number;
  porAprobar: number;
  rechazados: number;
  tercerosRegistrados: number;
  tercerosRechazados: number;
  recibidos: number;
  /** null = todo bien. Si hay error, lo pendiente sigue en la cola y se reintenta en la próxima. */
  error: string | null;
}

export const LIMITES = {
  comprobantesPorLote: 200,
  tercerosPorLote: 500,
  /** Vercel admite ~4,5 MB; se deja margen. */
  bytesPorLote: 3_000_000,
  cambiosPorPagina: 500,
};

const ahora = () => new Date().toISOString();

// ------------------------------------------------------------------ envío

async function leerTercero(base: BaseLocal, id: string): Promise<TerceroSync | null> {
  const [t] = await base.consultar<Record<string, string | number | null>>('select * from terceros where id = ?', [id]);
  if (!t) return null;
  return {
    id, tipo_doc: String(t['tipo_doc']), numero: String(t['numero']), dv: t['dv'] == null ? null : Number(t['dv']),
    nombre: String(t['nombre']), tipos: JSON.parse(String(t['tipos'])), responsabilidades: JSON.parse(String(t['responsabilidades'])),
    direccion: (t['direccion'] as string | null) ?? null, municipio: (t['municipio'] as string | null) ?? null,
    correo: (t['correo'] as string | null) ?? null, activo: !!t['activo'],
  };
}

async function leerComprobanteSync(base: BaseLocal, id: string): Promise<ComprobanteSync | null> {
  const [c] = await base.consultar<Record<string, string | null>>(
    'select id, tipo, fecha, concepto, origen, clave_idempotencia, reversa_de from comprobantes where id = ?', [id]);
  if (!c) return null;
  const lineas = await base.consultar<Record<string, string | null>>(
    `select cuenta, tercero_id, centro_costo_id, cast(debito as text) as debito, cast(credito as text) as credito,
            cast(base_impuesto as text) as base_impuesto, nota
       from lineas where comprobante_id = ? order by orden`, [id]);
  return {
    id, tipo: c['tipo']!, fecha: c['fecha']!, concepto: c['concepto']!, origen: c['origen'] as ComprobanteSync['origen'],
    clave_idempotencia: c['clave_idempotencia']!, reversa_de: c['reversa_de'] ?? null,
    lineas: lineas.map((l) => ({
      cuenta: l['cuenta']!, tercero_id: l['tercero_id'] ?? null, centro_costo_id: l['centro_costo_id'] ?? null,
      debito: aDecimal(BigInt(l['debito']!)), credito: aDecimal(BigInt(l['credito']!)),
      base_impuesto: l['base_impuesto'] == null ? null : aDecimal(BigInt(l['base_impuesto'])), nota: l['nota'] ?? null,
    })),
  };
}

/** Arma el siguiente lote respetando los límites. Terceros primero: los comprobantes pueden usarlos. */
async function siguienteLote(base: BaseLocal, empresa: string, dispositivo: Dispositivo): Promise<LoteEnvio | null> {
  const cola = await base.consultar<{ tipo: 'comprobante' | 'tercero'; registro_id: string }>(
    'select tipo, registro_id from cola_salida where empresa_id = ? order by seq', [empresa]);
  const terceros: TerceroSync[] = [];
  const comprobantes: ComprobanteSync[] = [];
  let bytes = 0;
  const huerfanos: Sentencia[] = [];
  for (const item of cola.filter((i) => i.tipo === 'tercero')) {
    if (terceros.length >= LIMITES.tercerosPorLote) break;
    const t = await leerTercero(base, item.registro_id);
    if (!t) { huerfanos.push(s(`delete from cola_salida where tipo = 'tercero' and registro_id = ?`, item.registro_id)); continue; }
    terceros.push(t);
    bytes += JSON.stringify(t).length;
  }
  // Si quedaron terceros sin enviar, este lote lleva solo terceros.
  const quedanTerceros = cola.filter((i) => i.tipo === 'tercero').length > terceros.length + huerfanos.length;
  if (!quedanTerceros) {
    for (const item of cola.filter((i) => i.tipo === 'comprobante')) {
      if (comprobantes.length >= LIMITES.comprobantesPorLote) break;
      const c = await leerComprobanteSync(base, item.registro_id);
      if (!c) { huerfanos.push(s(`delete from cola_salida where tipo = 'comprobante' and registro_id = ?`, item.registro_id)); continue; }
      const tam = JSON.stringify(c).length;
      if (comprobantes.length > 0 && bytes + tam > LIMITES.bytesPorLote) break;
      comprobantes.push(c);
      bytes += tam;
    }
  }
  if (huerfanos.length) await base.lote(huerfanos);
  if (terceros.length + comprobantes.length === 0) return null;
  return { version_protocolo: VERSION_PROTOCOLO, empresa_id: empresa, dispositivo, terceros, comprobantes };
}

function aplicarRespuesta(empresa: string, r: RespuestaEnvio, resumen: ResumenSincronizacion): Sentencia[] {
  const t = ahora();
  const out: Sentencia[] = [];
  for (const x of r.terceros) {
    if (x.estado === 'registrado' && x.id_servidor) {
      if (x.id_servidor !== x.id) {
        // Otro PC ya había creado este documento: se adopta el id del servidor en todo el PC.
        out.push(
          s('update lineas set tercero_id = ? where tercero_id = ?', x.id_servidor, x.id),
          s('update terceros set id = ? where id = ? and not exists (select 1 from terceros where id = ?)', x.id_servidor, x.id, x.id_servidor),
          s('delete from terceros where id = ?', x.id),
        );
      }
      out.push(s('update terceros set errores_sync = null where id = ?', x.id_servidor));
      resumen.tercerosRegistrados++;
    } else {
      out.push(s('update terceros set errores_sync = ? where id = ?', JSON.stringify(x.errores), x.id));
      resumen.tercerosRechazados++;
    }
    out.push(s(`delete from cola_salida where tipo = 'tercero' and registro_id = ?`, x.id));
  }
  for (const x of r.resultados) {
    resumen.enviados++;
    if (x.id_servidor && x.id_servidor !== x.id) {
      // El servidor ya tenía este documento (p. ej. la misma factura DIAN importada en otro PC):
      // se descarta la copia local; la del servidor llega en la descarga de cambios.
      if (x.estado === 'contabilizado') resumen.contabilizados++; else resumen.porAprobar++;
      out.push(
        s('update documentos_dian set comprobante_id = ? where comprobante_id = ?', x.id_servidor, x.id),
        s(`delete from cola_salida where tipo = 'comprobante' and registro_id = ?`, x.id),
        s('delete from comprobantes where id = ?', x.id),
      );
      continue;
    }
    if (x.estado === 'rechazado') {
      resumen.rechazados++;
      out.push(s(`update comprobantes set estado = 'rechazado', errores = ?, sincronizado_en = ? where id = ?`, JSON.stringify(x.errores), t, x.id));
    } else {
      if (x.estado === 'contabilizado') resumen.contabilizados++; else resumen.porAprobar++;
      out.push(s(`update comprobantes set estado = ?, numero = ?, errores = null, sincronizado_en = ? where id = ?`,
        x.estado === 'borrador' ? 'por_aprobar' : x.estado, x.numero, t, x.id));
    }
    out.push(s(`delete from cola_salida where tipo = 'comprobante' and registro_id = ?`, x.id));
  }
  out.push(s(`insert into estado_sync (empresa_id, ultimo_envio) values (?, ?)
              on conflict (empresa_id) do update set ultimo_envio = excluded.ultimo_envio`, empresa, t));
  return out;
}

async function enviarCola(base: BaseLocal, transporte: Transporte, empresa: string, dispositivo: Dispositivo, resumen: ResumenSincronizacion): Promise<boolean> {
  for (;;) {
    const lote = await siguienteLote(base, empresa, dispositivo);
    if (!lote) return true;
    let respuesta: RespuestaEnvio;
    try {
      respuesta = await transporte.enviar(lote);
    } catch (e) {
      // Nada se pierde: todo sigue en la cola y se reintenta en la próxima sincronización.
      const mensaje = e instanceof Error ? e.message : String(e);
      const ids = [...lote.terceros.map((t) => t.id), ...lote.comprobantes.map((c) => c.id)];
      await base.lote(ids.map((id) => s('update cola_salida set intentos = intentos + 1, ultimo_error = ? where registro_id = ?', mensaje, id)));
      resumen.error = mensaje;
      return false;
    }
    await base.lote(aplicarRespuesta(empresa, respuesta, resumen));
  }
}

// ------------------------------------------------------------------ recepción

const txt = (v: unknown) => (v == null ? null : String(v));
const bool = (v: unknown) => (v ? 1 : 0);
const fecha = (v: unknown) => {
  const f = String(v).slice(0, 10);
  if (!esFechaValida(f)) throw new Error(`Fecha inválida recibida del servidor: ${String(v)}`);
  return f;
};
const centavos = (v: unknown) => (v == null ? null : aCentavos(String(v)));

function sentenciasRegistros(empresa: string, registros: RespuestaCambios['registros']): Sentencia[] {
  const out: Sentencia[] = [];
  for (const c of registros.cuentas ?? []) {
    out.push(s(`insert into cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (empresa_id, codigo) do update set nombre = excluded.nombre, naturaleza = excluded.naturaleza, nivel = excluded.nivel,
                  acepta_movimiento = excluded.acepta_movimiento, exige_tercero = excluded.exige_tercero,
                  exige_centro_costo = excluded.exige_centro_costo, activa = excluded.activa`,
      empresa, txt(c['codigo']), txt(c['nombre']), txt(c['naturaleza']), Number(c['nivel']), bool(c['acepta_movimiento']),
      bool(c['exige_tercero']), bool(c['exige_centro_costo']), bool(c['activa'])));
  }
  for (const t of registros.tipos_comprobante ?? []) {
    out.push(s(`insert into tipos_comprobante (empresa_id, codigo, nombre, prefijo) values (?, ?, ?, ?)
                on conflict (empresa_id, codigo) do update set nombre = excluded.nombre, prefijo = excluded.prefijo`,
      empresa, txt(t['codigo']), txt(t['nombre']), txt(t['prefijo'])));
  }
  for (const p of registros.periodos ?? []) {
    out.push(s(`insert into periodos (empresa_id, anio, mes, estado) values (?, ?, ?, ?)
                on conflict (empresa_id, anio, mes) do update set estado = excluded.estado`,
      empresa, Number(p['anio']), Number(p['mes']), txt(p['estado'])));
  }
  for (const c of registros.centros_costo ?? []) {
    out.push(s(`insert into centros_costo (id, empresa_id, codigo, nombre, activo) values (?, ?, ?, ?, ?)
                on conflict (id) do update set codigo = excluded.codigo, nombre = excluded.nombre, activo = excluded.activo`,
      txt(c['id']), empresa, txt(c['codigo']), txt(c['nombre']), bool(c['activo'])));
  }
  for (const t of registros.terceros ?? []) {
    const id = txt(t['id']);
    const doc = [empresa, txt(t['tipo_doc']), txt(t['numero']), id] as const;
    // Si este PC tenía el mismo documento con otro id (y ya no está en la cola), gana el del servidor.
    const otros = `select id from terceros where empresa_id = ? and tipo_doc = ? and numero = ? and id <> ?
                     and not exists (select 1 from cola_salida c where c.tipo = 'tercero' and c.registro_id = terceros.id)`;
    out.push(
      s(`update lineas set tercero_id = ? where tercero_id in (${otros})`, id, ...doc),
      s(`delete from terceros where id in (${otros})`, ...doc),
      // Una edición local todavía en la cola no se pisa: se enviará y el servidor decidirá.
      s(`insert into terceros (id, empresa_id, tipo_doc, numero, dv, nombre, tipos, responsabilidades, direccion, municipio, correo, activo)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set tipo_doc = excluded.tipo_doc, numero = excluded.numero, dv = excluded.dv, nombre = excluded.nombre,
           tipos = excluded.tipos, responsabilidades = excluded.responsabilidades, direccion = excluded.direccion,
           municipio = excluded.municipio, correo = excluded.correo, activo = excluded.activo, errores_sync = null
         where not exists (select 1 from cola_salida c where c.tipo = 'tercero' and c.registro_id = excluded.id)`,
        id, empresa, txt(t['tipo_doc']), txt(t['numero']), t['dv'] == null ? null : Number(t['dv']), txt(t['nombre']),
        JSON.stringify(t['tipos'] ?? []), JSON.stringify(t['responsabilidades'] ?? []), txt(t['direccion']), txt(t['municipio']),
        txt(t['correo']), bool(t['activo'])),
    );
  }
  for (const c of registros.comprobantes ?? []) {
    const id = txt(c['id']);
    const estado = c['estado'] === 'borrador' ? 'por_aprobar' : txt(c['estado']);
    out.push(
      s(`insert into comprobantes (id, empresa_id, tipo, numero, fecha, concepto, estado, origen, clave_idempotencia, reversa_de, creado_en, sincronizado_en)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set tipo = excluded.tipo, numero = excluded.numero, fecha = excluded.fecha, concepto = excluded.concepto,
           estado = excluded.estado, origen = excluded.origen, reversa_de = excluded.reversa_de, errores = null,
           sincronizado_en = excluded.sincronizado_en`,
        id, empresa, txt(c['tipo']), txt(c['numero']), fecha(c['fecha']), txt(c['concepto']), estado, txt(c['origen']),
        txt(c['clave_idempotencia']), txt(c['reversa_de']), txt(c['creado_en']) ?? ahora(), ahora()),
      s('delete from lineas where comprobante_id = ?', id),
      ...((c['lineas'] as Record<string, unknown>[] | undefined) ?? []).map((l) => s(
        `insert into lineas (comprobante_id, orden, cuenta, tercero_id, centro_costo_id, debito, credito, base_impuesto, nota)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, Number(l['orden']), txt(l['cuenta']), txt(l['tercero_id']), txt(l['centro_costo_id']),
        centavos(l['debito']) ?? 0n, centavos(l['credito']) ?? 0n, centavos(l['base_impuesto']), txt(l['nota']))),
      // El servidor ya lo tiene: nada que reenviar.
      s(`delete from cola_salida where tipo = 'comprobante' and registro_id = ?`, id),
    );
  }
  return out;
}

async function recibirCambios(base: BaseLocal, transporte: Transporte, empresa: string, resumen: ResumenSincronizacion): Promise<boolean> {
  for (;;) {
    const [e] = await base.consultar<{ ultima_seq: number }>('select ultima_seq from estado_sync where empresa_id = ?', [empresa]);
    const desde = Number(e?.ultima_seq ?? 0);
    let r: RespuestaCambios;
    try {
      r = await transporte.cambios({ empresa_id: empresa, desde, limite: LIMITES.cambiosPorPagina });
    } catch (err) {
      resumen.error = err instanceof Error ? err.message : String(err);
      return false;
    }
    // La página y la nueva secuencia se guardan juntas: un apagón a mitad no deja la copia inconsistente.
    const sentencias = sentenciasRegistros(empresa, r.registros);
    sentencias.push(s(`insert into estado_sync (empresa_id, ultima_seq, ultima_recepcion) values (?, ?, ?)
                       on conflict (empresa_id) do update set ultima_seq = excluded.ultima_seq, ultima_recepcion = excluded.ultima_recepcion`,
      empresa, r.ultima_seq, ahora()));
    await base.lote(sentencias);
    resumen.recibidos += Object.values(r.registros).reduce((n, filas) => n + (filas?.length ?? 0), 0);
    if (!r.hay_mas) return true;
  }
}

/**
 * Sincroniza una empresa: primero sube la cola (sección 9.2) y luego baja los cambios (9.3).
 * Se puede llamar cuantas veces se quiera: es segura ante cortes de red y de energía.
 */
export async function sincronizar(
  base: BaseLocal, transporte: Transporte, opciones: { empresa: string; dispositivo: Dispositivo },
): Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = {
    enviados: 0, contabilizados: 0, porAprobar: 0, rechazados: 0, tercerosRegistrados: 0, tercerosRechazados: 0, recibidos: 0, error: null,
  };
  if (await enviarCola(base, transporte, opciones.empresa, opciones.dispositivo, resumen)) {
    await recibirCambios(base, transporte, opciones.empresa, resumen);
  }
  return resumen;
}

// ------------------------------------------------------------------ transporte HTTP

export function transporteHttp(o: {
  urlBase: string;
  /** Token de acceso vigente de Supabase Auth. */
  token: () => Promise<string>;
  /** Fuerza la renovación del token (se llama una vez si el servidor responde 401). */
  renovarToken?: () => Promise<string>;
  fetch?: typeof fetch;
  tiempoMaximoMs?: number;
}): Transporte {
  const f = o.fetch ?? globalThis.fetch;
  async function pedir<T>(ruta: string, init: RequestInit): Promise<T> {
    for (let intento = 0; intento < 2; intento++) {
      const token = intento === 0 ? await o.token() : await o.renovarToken!();
      let res: Response;
      try {
        res = await f(`${o.urlBase}${ruta}`, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(o.tiempoMaximoMs ?? 60_000),
        });
      } catch {
        throw new ErrorTransporte(0, 'SIN_CONEXION', 'No hay conexión con el servidor.');
      }
      if (res.status === 401 && intento === 0 && o.renovarToken) continue;
      const cuerpo = await res.json().catch(() => ({})) as { error?: string; mensaje?: string };
      if (!res.ok) throw new ErrorTransporte(res.status, cuerpo.error ?? 'ERROR_SERVIDOR', cuerpo.mensaje ?? `El servidor respondió ${res.status}.`);
      return cuerpo as T;
    }
    throw new ErrorTransporte(401, 'SESION_INVALIDA', 'La sesión venció. Inicie sesión de nuevo.');
  }
  return {
    enviar: (lote) => pedir<RespuestaEnvio>('/api/sync/enviar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lote),
    }),
    cambios: (q) => pedir<RespuestaCambios>(`/api/sync/cambios?${new URLSearchParams({
      empresa_id: q.empresa_id, desde: String(q.desde), limite: String(q.limite),
    })}`, { method: 'GET' }),
  };
}
