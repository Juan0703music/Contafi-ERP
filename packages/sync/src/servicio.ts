import { aCentavos } from '@contafi/shared';
import { contextoDesdeCuentas, validarComprobante, type Cuenta, type Linea } from '@contafi/motor';
import {
  TABLAS_SYNC, VERSION_PROTOCOLO,
  type Cambio, type ComprobanteSync, type ConsultaCambios, type LoteEnvio, type RespuestaCambios,
  type RespuestaEnvio, type ResultadoItem, type TablaSync,
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
  marcarSincronizacion(d: { id: string; nombre: string; version_app: string }): Promise<void>;
  cambios(empresaId: string, desde: number, limite: number): Promise<Cambio[]>;
  registros(empresaId: string, tabla: TablaSync, ids: string[]): Promise<Record<string, unknown>[]>;
}

export class ErrorAcceso extends Error {
  override name = 'ErrorAcceso';
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

const aResultado = (clave: string, r: ResultadoRegistro): ResultadoItem => ({
  id: r.id,
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
  const { cuentas, periodosCerrados } = await repo.contexto(lote.empresa_id);
  const ctx = contextoDesdeCuentas(cuentas, periodosCerrados);

  const resultados: ResultadoItem[] = [];
  for (const c of lote.comprobantes) {
    const errores = validarComprobante({ fecha: c.fecha, concepto: c.concepto, lineas: aLineasMotor(c) }, ctx);
    if (errores.length > 0) {
      // Puede ser un reintento de algo que ya entró (y, por ejemplo, el período se cerró después).
      const existente = await repo.buscarPorClave(lote.empresa_id, c.clave_idempotencia);
      resultados.push(existente
        ? aResultado(c.clave_idempotencia, { ...existente, repetido: true })
        : { id: c.id, clave_idempotencia: c.clave_idempotencia, estado: 'rechazado', numero: null, errores, repetido: false });
      continue;
    }
    const r = await repo.registrar({ ...c, empresa_id: lote.empresa_id, dispositivo_id: lote.dispositivo.id });
    resultados.push(aResultado(c.clave_idempotencia, r));
  }
  await repo.marcarSincronizacion(lote.dispositivo);
  return { version_protocolo: VERSION_PROTOCOLO, resultados };
}

/** Clave usada en `cambios.registro_id` para cada tabla. */
export function claveRegistro(tabla: TablaSync, fila: Record<string, unknown>): string {
  switch (tabla) {
    case 'cuentas':
    case 'tipos_comprobante':
      return String(fila['codigo']);
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
