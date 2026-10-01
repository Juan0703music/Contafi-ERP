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
  /** Inventario: producto y cantidad (texto decimal, hasta 3 decimales). */
  producto_id: uuid.nullish(),
  cantidad: z.string().regex(/^\d{1,15}(\.\d{1,3})?$/).nullish(),
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

export const TIPOS_TERCERO = ['cliente', 'proveedor', 'empleado', 'otro'] as const;

/** Tercero creado o editado en el PC (posiblemente sin conexión). */
export const terceroSync = z.object({
  id: uuid,
  /** 31 NIT, 13 cédula, 22 cédula de extranjería, 41 pasaporte... */
  tipo_doc: z.string().regex(/^\d{2}$/),
  numero: z.string().trim().regex(/^[0-9A-Za-z]{3,20}$/),
  dv: z.number().int().min(0).max(9).nullish(),
  nombre: z.string().trim().min(1).max(300),
  tipos: z.array(z.enum(TIPOS_TERCERO)).max(4).default([]),
  responsabilidades: z.array(z.string().max(20)).max(30).default([]),
  direccion: z.string().max(300).nullish(),
  municipio: z.string().max(100).nullish(),
  correo: z.email().max(200).nullish(),
  activo: z.boolean().default(true),
});

export const productoSync = z.object({
  id: uuid,
  codigo: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1).max(200),
  tipo: z.enum(['producto', 'servicio']).default('producto'),
  unidad: z.string().trim().min(1).max(10).default('UND'),
  cuenta_inventario: z.string().regex(/^[1-9][0-9]*$/).default('143505'),
  iva_tipo: z.enum(['gravado', 'exento', 'excluido']).default('gravado'),
  iva_tarifa_ppm: z.number().int().min(0).max(1_000_000).nullish(),
  precio_venta: monto.nullish(),
  activo: z.boolean().default(true),
});

/**
 * Cuenta nueva o editada del plan de cuentas. Naturaleza, nivel y "acepta movimiento" no viajan:
 * el servidor los deriva del código y de la cuenta padre.
 */
export const cuentaSync = z.object({
  codigo: z.string().regex(/^[1-9][0-9]*$/).max(12),
  nombre: z.string().trim().min(1).max(200),
  exige_tercero: z.boolean().default(false),
  exige_centro_costo: z.boolean().default(false),
  activa: z.boolean().default(true),
});

export const loteEnvio = z.object({
  version_protocolo: z.literal(VERSION_PROTOCOLO),
  empresa_id: uuid,
  dispositivo: z.object({ id: uuid, nombre: z.string().trim().min(1).max(100), version_app: z.string().max(50) }),
  /** Cuentas nuevas o editadas: van primero (productos y comprobantes pueden usarlas). */
  cuentas: z.array(cuentaSync).max(500).default([]),
  /** Terceros nuevos o editados: se registran ANTES que los comprobantes que los usan. */
  terceros: z.array(terceroSync).max(500).default([]),
  /** Productos nuevos o editados: también antes que los comprobantes. */
  productos: z.array(productoSync).max(500).default([]),
  /** En el orden en que se crearon en el PC. */
  comprobantes: z.array(comprobanteSync).max(200).default([]),
}).refine((l) => l.cuentas.length + l.terceros.length + l.productos.length + l.comprobantes.length > 0, 'El lote está vacío.');

export const consultaCambios = z.object({
  empresa_id: uuid,
  /** Última secuencia que el PC ya tiene (0 = descarga inicial). */
  desde: z.coerce.number().int().min(0),
  limite: z.coerce.number().int().min(1).max(1000).default(500),
});

export type CuentaSync = z.infer<typeof cuentaSync>;
export type TerceroSync = z.infer<typeof terceroSync>;
export type ProductoSync = z.infer<typeof productoSync>;
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
  /** Id con que el PC envió el comprobante. */
  id: string;
  /**
   * Id del comprobante en el servidor. Si difiere de `id`, el servidor ya tenía ese documento
   * (misma clave, p. ej. la misma factura DIAN importada en otro PC): el PC descarta su copia y
   * recibe la del servidor en la siguiente descarga de cambios.
   */
  id_servidor: string | null;
  clave_idempotencia: string;
  /** contabilizado: tiene número oficial · borrador: espera aprobación · rechazado: corregir y reenviar con otra clave. */
  estado: 'contabilizado' | 'borrador' | 'rechazado';
  numero: string | null;
  errores: ErrorItem[];
  /** true si ya se había recibido antes (reintento). */
  repetido: boolean;
}

export interface ResultadoTercero {
  /** Id con que el PC lo creó. */
  id: string;
  /** Id definitivo en el servidor. Si difiere, otro PC ya había creado ese documento: la app reescribe sus referencias. */
  id_servidor: string | null;
  estado: 'registrado' | 'rechazado';
  errores: ErrorItem[];
}

export interface ResultadoCuenta {
  codigo: string;
  estado: 'registrado' | 'rechazado';
  errores: ErrorItem[];
  /**
   * Si se rechazó: la cuenta como está en el servidor (null = no existe allá). Con esto el PC deshace
   * su cambio local, porque un rechazo no genera cambios que bajar.
   */
  actual?: Record<string, unknown> | null;
}

export interface RespuestaEnvio {
  version_protocolo: typeof VERSION_PROTOCOLO;
  /** Ausente en servidores anteriores al PUC personalizable. */
  cuentas?: ResultadoCuenta[];
  terceros: ResultadoTercero[];
  /** Mismo formato que los terceros: id_servidor distinto si otro PC ya creó ese código. */
  productos: ResultadoTercero[];
  resultados: ResultadoItem[];
}

/**
 * Tablas que bajan a los PC. `uvt` es la UVT de la firma por año (clave: el año) y `conceptos_empresa`
 * los conceptos de retención de la empresa (clave: el código).
 */
export const TABLAS_SYNC = ['cuentas', 'terceros', 'productos', 'centros_costo', 'periodos', 'tipos_comprobante', 'uvt', 'conceptos_empresa', 'comprobantes'] as const;
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
