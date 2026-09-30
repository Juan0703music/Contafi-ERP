import type { Centavos, FechaISO, TarifaPpm } from '@contafi/shared';

export type TipoDocumentoDian = 'factura' | 'nota_credito' | 'nota_debito';

export interface ParteDian {
  nit: string;
  dv: string | null;
  /** Código del tipo de documento (31 = NIT, 13 = cédula...). */
  tipoDocumento: string | null;
  razonSocial: string;
  /** Responsabilidades fiscales (TaxLevelCode), p. ej. ["O-13", "O-15"]. */
  responsabilidades: string[];
  municipio: string | null;
  codigoMunicipio: string | null;
  direccion: string | null;
  correo: string | null;
}

export interface ImpuestoDian {
  /** 01 IVA, 03 ICA, 04 INC, 05 ReteIVA, 06 ReteFuente, 07 ReteICA... */
  codigo: string;
  nombre: string;
  tarifa: TarifaPpm | null;
  base: Centavos;
  valor: Centavos;
}

export interface LineaDian {
  numero: string;
  descripcion: string;
  codigoProducto: string | null;
  cantidad: string;
  unidad: string | null;
  valorUnitario: Centavos | null;
  subtotal: Centavos;
  impuestos: ImpuestoDian[];
}

export interface DocumentoDian {
  tipo: TipoDocumentoDian;
  numero: string;
  /** CUFE (facturas) o CUDE (notas). Clave para detectar duplicados. */
  cufe: string;
  fechaEmision: FechaISO;
  horaEmision: string | null;
  fechaVencimiento: FechaISO | null;
  tipoOperacion: string | null;
  codigoTipo: string | null;
  moneda: string;
  emisor: ParteDian;
  adquiriente: ParteDian;
  subtotal: Centavos; // LineExtensionAmount
  baseGravable: Centavos; // TaxExclusiveAmount
  totalConImpuestos: Centavos; // TaxInclusiveAmount
  descuentos: Centavos; // AllowanceTotalAmount
  cargos: Centavos; // ChargeTotalAmount
  anticipos: Centavos; // PrepaidAmount
  redondeo: Centavos; // PayableRoundingAmount
  totalAPagar: Centavos; // PayableAmount
  impuestos: ImpuestoDian[];
  /** Retenciones informadas en el XML (WithholdingTaxTotal). Informativas: las practica el comprador. */
  retenciones: ImpuestoDian[];
  lineas: LineaDian[];
  /** Para notas: factura a la que se refieren. */
  referencia: { numero: string; cufe: string | null; fecha: FechaISO | null } | null;
  /** Resultado de validación DIAN si venía en el AttachedDocument (ApplicationResponse). */
  validacionDian: { codigo: string; descripcion: string } | null;
  /** Inconsistencias encontradas al cruzar totales. No bloquean, pero se muestran al contador. */
  advertencias: string[];
}
