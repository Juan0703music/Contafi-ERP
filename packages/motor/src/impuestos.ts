import { aCentavos, aplicarTarifa, dividirRedondeado, type Centavos, type TarifaPpm } from '@contafi/shared';

/**
 * REGLA DE ORO (sección 5.5): tarifas, bases mínimas en UVT y valor de la UVT vienen de tablas de
 * parámetros por año (parametros_anuales, impuestos, conceptos_retencion). Nada de esto se escribe fijo.
 */
export interface ParametrosAnuales {
  anio: number;
  /** Valor de la UVT del año, en centavos. */
  uvt: Centavos;
}

export type TipoIva = 'gravado' | 'exento' | 'excluido';

export interface IvaItem {
  tipo: TipoIva;
  /** Solo para gravado: 19 % = 190_000n, 5 % = 50_000n. */
  tarifa?: TarifaPpm;
}

export type TipoRetencion = 'RETEFUENTE' | 'RETEIVA' | 'RETEICA';

export interface ConceptoRetencion {
  tipo: TipoRetencion;
  codigo: string;
  nombre: string;
  tarifa: TarifaPpm;
  /** Base mínima en UVT, como texto decimal ("10", "2", "0"). */
  baseMinimaUvt: string;
  /** Cuenta donde se registra: por pagar (si la practicamos) o a favor (si nos la practican). */
  cuenta: string;
}

export interface ResultadoRetencion {
  tipo: TipoRetencion;
  codigo: string;
  nombre: string;
  base: Centavos;
  tarifa: TarifaPpm;
  valor: Centavos;
  cuenta: string;
  /** false si la base no alcanzó el mínimo; valor = 0. */
  aplica: boolean;
}

export function uvtACentavos(uvts: string, p: ParametrosAnuales): Centavos {
  // aCentavos("10") = 1000 (centésimas de UVT) → × valor UVT / 100
  return dividirRedondeado(aCentavos(uvts) * p.uvt, 100n);
}

/**
 * Calcula una retención. Para RETEIVA la base es el IVA del documento; para RETEFUENTE y RETEICA,
 * la base gravable (subtotal antes de IVA). La base mínima se compara contra la base del subtotal
 * en todos los casos (confirmar con el asesor el tratamiento de reteIVA).
 */
export function calcularRetencion(
  concepto: ConceptoRetencion,
  bases: { subtotal: Centavos; iva: Centavos },
  p: ParametrosAnuales,
): ResultadoRetencion {
  const baseMinima = uvtACentavos(concepto.baseMinimaUvt, p);
  const aplica = bases.subtotal >= baseMinima && bases.subtotal > 0n;
  const base = concepto.tipo === 'RETEIVA' ? bases.iva : bases.subtotal;
  const valor = aplica ? aplicarTarifa(base, concepto.tarifa) : 0n;
  return {
    tipo: concepto.tipo, codigo: concepto.codigo, nombre: concepto.nombre,
    base, tarifa: concepto.tarifa, valor, cuenta: concepto.cuenta, aplica: aplica && valor > 0n,
  };
}
