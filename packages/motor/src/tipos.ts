import type { Centavos, FechaISO, Naturaleza } from '@contafi/shared';

export interface Cuenta {
  codigo: string;
  nombre: string;
  naturaleza: Naturaleza;
  aceptaMovimiento: boolean;
  exigeTercero: boolean;
  exigeCentroCosto: boolean;
  activa: boolean;
}

export interface Linea {
  cuenta: string;
  terceroId?: string | null;
  centroCostoId?: string | null;
  debito: Centavos;
  credito: Centavos;
  /** Base gravable, para auxiliares de impuestos y retenciones. */
  base?: Centavos | null;
  nota?: string | null;
  /** Inventario: producto y cantidad (en milésimas) de la línea sobre la cuenta de inventario. */
  productoId?: string | null;
  cantidad?: bigint | null;
}

/**
 * Estados (sección 7 del plan).
 * - borrador: editable, no afecta saldos.
 * - pendiente_sync: guardado en el PC sin conexión, sin número oficial, no afecta saldos oficiales.
 * - contabilizado: tiene consecutivo oficial; inmutable.
 * - anulado: fue contabilizado y tiene un comprobante de reverso. Sigue en libros (el reverso lo neutraliza).
 * - rechazado: el servidor lo rechazó; el usuario lo corrige.
 */
export type EstadoComprobante = 'borrador' | 'pendiente_sync' | 'contabilizado' | 'anulado' | 'rechazado';

/** Estados que afectan los libros oficiales. */
export const EN_LIBROS: ReadonlySet<EstadoComprobante> = new Set(['contabilizado', 'anulado']);

export type OrigenComprobante =
  | 'manual' | 'factura_venta' | 'factura_compra' | 'nota_credito_venta' | 'nota_credito_compra'
  | 'recaudo' | 'pago' | 'tesoreria' | 'importacion_dian' | 'cierre_anual' | 'saldos_iniciales' | 'reverso';

export interface Comprobante {
  id: string;
  empresaId: string;
  tipo: string;
  /** Vacío mientras no lo contabilice el servidor. */
  numero: string | null;
  fecha: FechaISO;
  concepto: string;
  estado: EstadoComprobante;
  origen: OrigenComprobante;
  lineas: Linea[];
  reversaDe?: string | null;
  claveIdempotencia?: string | null;
}

/** Lo que el motor necesita saber del mundo para validar. Sin acceso a disco ni red. */
export interface ContextoContable {
  cuenta(codigo: string): Cuenta | undefined;
  periodoCerrado(periodo: string): boolean;
}

export function contextoDesdeCuentas(cuentas: Iterable<Cuenta>, periodosCerrados: Iterable<string> = []): ContextoContable {
  const mapa = new Map<string, Cuenta>();
  for (const c of cuentas) mapa.set(c.codigo, c);
  const cerrados = new Set(periodosCerrados);
  return { cuenta: (codigo) => mapa.get(codigo), periodoCerrado: (p) => cerrados.has(p) };
}
