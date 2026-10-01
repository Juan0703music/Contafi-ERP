import { aCentavos, calcularDV } from '@contafi/shared';
import { contextoDesdeCuentas, validarComprobante, type Cuenta, type Linea } from '@contafi/motor';
import {
  TABLAS_SYNC, VERSION_PROTOCOLO,
  type Cambio, type ComprobanteSync, type ConsultaCambios, type ErrorItem, type LoteEnvio, type RespuestaCambios,
  type CuentaSync, type ProductoSync, type ReglaProveedorSync, type RespuestaEnvio, type ResultadoCuenta, type ResultadoItem, type ResultadoTercero, type TablaSync, type TerceroSync,
} from './protocolo.ts';

export interface ResultadoRegistro {
  id: string;
  estado: 'contabilizado' | 'borrador' | 'rechazado';
  numero: string | null;
  motivo: string | null;
  repetido: boolean;
}

/**
 * Acceso a datos con la sesión del usuario (RLS aplica). Implementaciones: Supabase (apps/web) y
 * PGlite (pruebas). El servicio no sabe nada de HTTP ni de Supabase.
 */
export interface RepositorioSync {
  puedeRegistrar(empresaId: string): Promise<boolean>;
  puedeLeer(empresaId: string): Promise<boolean>;
  contexto(empresaId: string): Promise<{ cuentas: Cuenta[]; periodosCerrados: string[] }>;
  buscarPorClave(empresaId: string, clave: string): Promise<ResultadoRegistro | null>;
  registrar(p: ComprobanteSync & { empresa_id: string; dispositivo_id: string }): Promise<ResultadoRegistro>;
  /** Crea o edita una cuenta del PUC. Lanza ErrorRegistro si viola las reglas del plan de cuentas. */
  registrarCuenta(p: CuentaSync & { empresa_id: string }): Promise<void>;
  /** Guarda lo aprendido de un proveedor. Lanza ErrorRegistro si la cuenta no sirve. */
  aprenderRegla(p: ReglaProveedorSync & { empresa_id: string }): Promise<void>;
  /** Devuelve el id definitivo. Lanza ErrorRegistro si los datos no son válidos. */
  registrarTercero(p: TerceroSync & { empresa_id: string }): Promise<string>;
  /** Devuelve el id definitivo. Lanza ErrorRegistro si los datos no son válidos. */
  registrarProducto(p: ProductoSync & { empresa_id: string }): Promise<string>;
  marcarSincronizacion(d: { id: string; nombre: string; version_app: string }): Promise<void>;
  cambios(empresaId: string, desde: number, limite: number): Promise<Cambio[]>;
  registros(empresaId: string, tabla: TablaSync, ids: string[]): Promise<Record<string, unknown>[]>;
}

export class ErrorAcceso extends Error {
  override name = 'ErrorAcceso';
}

/** Error de datos de un registro puntual (no de sesión ni de red): se informa en su resultado y el lote sigue. */
export class ErrorRegistro extends Error {
  override name = 'ErrorRegistro';
  readonly codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

async function registrarTerceros(
  repo: RepositorioSync, empresa: string, terceros: readonly TerceroSync[],
): Promise<ResultadoTercero[]> {
  const resultados: ResultadoTercero[] = [];
  for (const t of terceros) {
    const errores: ErrorItem[] = [];
    if (t.tipo_doc === '31') {
      try {
        if (t.dv == null || calcularDV(t.numero) !== t.dv) {
          errores.push({ codigo: 'DV_INVALIDO', mensaje: `El dígito de verificación del NIT ${t.numero} es ${calcularDV(t.numero)}.` });
        }
      } catch {
        errores.push({ codigo: 'NIT_INVALIDO', mensaje: `NIT inválido: ${t.numero}.` });
      }
    }
    if (errores.length === 0) {
      try {
        const id_servidor = await repo.registrarTercero({ ...t, empresa_id: empresa });
        resultados.push({ id: t.id, id_servidor, estado: 'registrado', errores: [] });
        continue;
      } catch (e) {
        if (!(e instanceof ErrorRegistro)) throw e;
        errores.push({ codigo: e.codigo, mensaje: e.message });
      }
    }
    resultados.push({ id: t.id, id_servidor: null, estado: 'rechazado', errores });
  }
  return resultados;
}

function aLineasMotor(c: ComprobanteSync): Linea[] {
  return c.lineas.map((l) => ({
    cuenta: l.cuenta,
    terceroId: l.tercero_id ?? null,
    centroCostoId: l.centro_costo_id ?? null,
    debito: aCentavos(l.debito),
    credito: aCentavos(l.credito),
  }));
}

/** "DESCUADRADO: débitos..." -> "DESCUADRADO" */
function codigoDeMotivo(motivo: string | null): string {
  const m = /^([A-Z_]{4,}):/.exec(motivo ?? '');
  return m ? m[1]! : 'RECHAZADO_SERVIDOR';
}

const aResultado = (idEnviado: string, clave: string, r: ResultadoRegistro): ResultadoItem => ({
  id: idEnviado,
  id_servidor: r.estado === 'rechazado' ? null : r.id,
  clave_idempotencia: clave,
  estado: r.estado,
  numero: r.numero,
  errores: r.estado === 'rechazado' ? [{ codigo: codigoDeMotivo(r.motivo), mensaje: r.motivo ?? 'Rechazado por el servidor' }] : [],
  repetido: r.repetido,
});

/**
 * Procesa la cola de salida de un PC (sección 9.2). Cada comprobante se valida con el MISMO motor que
 * usa la app y luego lo registra Postgres, que vuelve a validar, asigna el consecutivo y audita.
 * Un rechazo no detiene el lote: cada comprobante tiene su propio resultado.
 */
export async function procesarEnvio(repo: RepositorioSync, lote: LoteEnvio): Promise<RespuestaEnvio> {
  if (!(await repo.puedeRegistrar(lote.empresa_id))) {
    throw new ErrorAcceso('No tiene permiso para registrar comprobantes en esta empresa.');
  }
  // 1. Cuentas, terceros y productos primero: los comprobantes del lote pueden usarlos.
  const cuentas: ResultadoCuenta[] = [];
  for (const c of lote.cuentas) {
    try {
      await repo.registrarCuenta({ ...c, empresa_id: lote.empresa_id });
      cuentas.push({ codigo: c.codigo, estado: 'registrado', errores: [] });
    } catch (e) {
      if (!(e instanceof ErrorRegistro)) throw e;
      const [actual] = await repo.registros(lote.empresa_id, 'cuentas', [c.codigo]);
      cuentas.push({ codigo: c.codigo, estado: 'rechazado', errores: [{ codigo: e.codigo, mensaje: e.message }], actual: actual ?? null });
    }
  }
  const reglas: NonNullable<RespuestaEnvio['reglas']> = [];
  for (const r of lote.reglas) {
    try {
      await repo.aprenderRegla({ ...r, empresa_id: lote.empresa_id });
      reglas.push({ nit: r.nit, estado: 'registrado', errores: [] });
    } catch (e) {
      if (!(e instanceof ErrorRegistro)) throw e;
      reglas.push({ nit: r.nit, estado: 'rechazado', errores: [{ codigo: e.codigo, mensaje: e.message }] });
    }
  }
  const terceros = await registrarTerceros(repo, lote.empresa_id, lote.terceros);
  const productos: ResultadoTercero[] = [];
  for (const p of lote.productos) {
    try {
      productos.push({ id: p.id, id_servidor: await repo.registrarProducto({ ...p, empresa_id: lote.empresa_id }), estado: 'registrado', errores: [] });
    } catch (e) {
      if (!(e instanceof ErrorRegistro)) throw e;
      productos.push({ id: p.id, id_servidor: null, estado: 'rechazado', errores: [{ codigo: e.codigo, mensaje: e.message }] });
    }
  }
  const idServidor = new Map(terceros.filter((t) => t.id_servidor).map((t) => [t.id, t.id_servidor!]));
  const rechazados = new Set(terceros.filter((t) => t.estado === 'rechazado').map((t) => t.id));
  const productoServidor = new Map(productos.filter((p) => p.id_servidor).map((p) => [p.id, p.id_servidor!]));
  const productosRechazados = new Set(productos.filter((p) => p.estado === 'rechazado').map((p) => p.id));

  const contexto = await repo.contexto(lote.empresa_id);
  const ctx = contextoDesdeCuentas(contexto.cuentas, contexto.periodosCerrados);

  // 2. Comprobantes, con las referencias a terceros reescritas al id definitivo.
  const resultados: ResultadoItem[] = [];
  for (const original of lote.comprobantes) {
    const c: ComprobanteSync = {
      ...original,
      lineas: original.lineas.map((l) => ({
        ...l,
        ...(l.tercero_id && idServidor.has(l.tercero_id) ? { tercero_id: idServidor.get(l.tercero_id)! } : {}),
        ...(l.producto_id && productoServidor.has(l.producto_id) ? { producto_id: productoServidor.get(l.producto_id)! } : {}),
      })),
    };
    const errores: ErrorItem[] = validarComprobante({ fecha: c.fecha, concepto: c.concepto, lineas: aLineasMotor(c) }, ctx);
    original.lineas.forEach((l, i) => {
      if (l.tercero_id && rechazados.has(l.tercero_id)) {
        errores.push({ codigo: 'TERCERO_RECHAZADO', linea: i, mensaje: `Línea ${i + 1}: el tercero no se pudo registrar; corríjalo primero.` });
      }
      if (l.producto_id && productosRechazados.has(l.producto_id)) {
        errores.push({ codigo: 'PRODUCTO_RECHAZADO', linea: i, mensaje: `Línea ${i + 1}: el producto no se pudo registrar; corríjalo primero.` });
      }
    });
    if (errores.length > 0) {
      // Puede ser un reintento de algo que ya entró (y, por ejemplo, el período se cerró después).
      const existente = await repo.buscarPorClave(lote.empresa_id, c.clave_idempotencia);
      resultados.push(existente
        ? aResultado(c.id, c.clave_idempotencia, { ...existente, repetido: true })
        : { id: c.id, id_servidor: null, clave_idempotencia: c.clave_idempotencia, estado: 'rechazado', numero: null, errores, repetido: false });
      continue;
    }
    const r = await repo.registrar({ ...c, empresa_id: lote.empresa_id, dispositivo_id: lote.dispositivo.id });
    resultados.push(aResultado(c.id, c.clave_idempotencia, r));
  }
  await repo.marcarSincronizacion(lote.dispositivo);
  return { version_protocolo: VERSION_PROTOCOLO, cuentas, reglas, terceros, productos, resultados };
}

/** Clave usada en `cambios.registro_id` para cada tabla. */
export function claveRegistro(tabla: TablaSync, fila: Record<string, unknown>): string {
  switch (tabla) {
    case 'cuentas':
    case 'tipos_comprobante':
    case 'conceptos_empresa':
      return String(fila['codigo']);
    case 'uvt':
      return String(fila['anio']);
    case 'reglas_proveedor':
      return String(fila['nit']);
    case 'periodos':
      return `${fila['anio']}-${fila['mes']}`;
    default:
      return String(fila['id']);
  }
}

/** Recepción incremental (sección 9.3): lo que cambió después de `desde`, con el estado actual de cada registro. */
export async function obtenerCambios(repo: RepositorioSync, q: ConsultaCambios): Promise<RespuestaCambios> {
  if (!(await repo.puedeLeer(q.empresa_id))) {
    throw new ErrorAcceso('No tiene acceso a esta empresa.');
  }
  const lote = await repo.cambios(q.empresa_id, q.desde, q.limite + 1);
  const hay_mas = lote.length > q.limite;
  const cambios = hay_mas ? lote.slice(0, q.limite) : lote;

  const porTabla = new Map<TablaSync, Set<string>>();
  for (const c of cambios) {
    if (!(TABLAS_SYNC as readonly string[]).includes(c.tabla)) continue;
    const t = c.tabla as TablaSync;
    if (!porTabla.has(t)) porTabla.set(t, new Set());
    porTabla.get(t)!.add(c.registro_id);
  }
  const registros: RespuestaCambios['registros'] = {};
  for (const [tabla, ids] of porTabla) {
    registros[tabla] = await repo.registros(q.empresa_id, tabla, [...ids]);
  }
  return {
    version_protocolo: VERSION_PROTOCOLO,
    registros,
    ultima_seq: cambios.length ? cambios[cambios.length - 1]!.seq : q.desde,
    hay_mas,
  };
}
