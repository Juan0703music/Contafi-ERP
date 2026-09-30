/**
 * Protocolo de sincronización entre la app de escritorio y el servidor (sección 9 del plan).
 * Los montos viajan como texto decimal ("1234.56"): JSON no tiene bigint y number pierde precisión.
 */
import { z } from 'zod';

export const VERSION_PROTOCOLO = 1;

const monto = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Monto inválido: use texto decimal con máximo 2 decimales');
const uuid = z.uuid();

export const lineaSync = z.object({
  cuenta: z.string().regex(/^[1-9][0-9]*$/),
  tercero_id: uuid.nullish(),
  centro_costo_id: uuid.nullish(),
  debito: monto,
  credito: monto,
  base_impuesto: monto.nullish(),
  nota: z.string().max(500).nullish(),
});

export const ORIGENES = [
  'manual', 'factura_venta', 'factura_compra', 'nota_credito_venta', 'nota_credito_compra', 'recaudo', 'pago',
  'tesoreria', 'importacion_dian', 'cierre_anual', 'saldos_iniciales', 'reverso',
] as const;

export const comprobanteSync = z.object({
  /** UUID generado en el PC al crear el comprobante (sección 9.1). */
  id: uuid,
  tipo: z.string().regex(/^[A-Z]{1,5}$/),
  fecha: z.iso.date(),
  concepto: z.string().trim().min(1).max(500),
  origen: z.enum(ORIGENES).default('manual'),
  /** Estable entre reintentos: si el envío se repite, el servidor no duplica. */
  clave_idempotencia: z.string().min(8).max(200),
  reversa_de: uuid.nullish(),
  lineas: z.array(lineaSync).min(1).max(5000),
});

export const loteEnvio = z.object({
  version_protocolo: z.literal(VERSION_PROTOCOLO),
  empresa_id: uuid,
  dispositivo: z.object({ id: uuid, nombre: z.string().trim().min(1).max(100), version_app: z.string().max(50) }),
  /** En el orden en que se crearon en el PC. */
  comprobantes: z.array(comprobanteSync).min(1).max(200),
});

export const consultaCambios = z.object({
  empresa_id: uuid,
  /** Última secuencia que el PC ya tiene (0 = descarga inicial). */
  desde: z.coerce.number().int().min(0),
  limite: z.coerce.number().int().min(1).max(1000).default(500),
});

export type LineaSync = z.infer<typeof lineaSync>;
export type ComprobanteSync = z.infer<typeof comprobanteSync>;
export type LoteEnvio = z.infer<typeof loteEnvio>;
export type ConsultaCambios = z.infer<typeof consultaCambios>;

export interface ErrorItem {
  codigo: string;
  mensaje: string;
  linea?: number;
}

export interface ResultadoItem {
  id: string;
  clave_idempotencia: string;
  /** contabilizado: tiene número oficial · borrador: espera aprobación · rechazado: corregir y reenviar con otra clave. */
  estado: 'contabilizado' | 'borrador' | 'rechazado';
  numero: string | null;
  errores: ErrorItem[];
  /** true si ya se había recibido antes (reintento). */
  repetido: boolean;
}

export interface RespuestaEnvio {
  version_protocolo: typeof VERSION_PROTOCOLO;
  resultados: ResultadoItem[];
}

export const TABLAS_SYNC = ['cuentas', 'terceros', 'centros_costo', 'periodos', 'tipos_comprobante', 'comprobantes'] as const;
export type TablaSync = (typeof TABLAS_SYNC)[number];

export interface Cambio {
  seq: number;
  tabla: string;
  registro_id: string;
  operacion: 'INSERT' | 'UPDATE';
}

export interface RespuestaCambios {
  version_protocolo: typeof VERSION_PROTOCOLO;
  /** Estado ACTUAL de cada registro que cambió (si cambió varias veces, llega una sola vez). */
  registros: Partial<Record<TablaSync, Record<string, unknown>[]>>;
  /** Guardar este valor y enviarlo como `desde` en la próxima consulta. */
  ultima_seq: number;
  /** true = hay más cambios: volver a consultar de inmediato. */
  hay_mas: boolean;
}
