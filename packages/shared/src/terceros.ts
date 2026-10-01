/**
 * Responsabilidades fiscales del RUT que se usan en la facturación electrónica (DIAN, anexo técnico de
 * factura electrónica, tabla de responsabilidades fiscales). Son códigos, no tarifas. Las facturas
 * importadas pueden traer otros códigos: se conservan tal como vienen.
 */
export const RESPONSABILIDADES_FISCALES = {
  'O-13': 'Gran contribuyente',
  'O-15': 'Autorretenedor',
  'O-23': 'Agente de retención en el impuesto sobre las ventas',
  'O-47': 'Régimen simple de tributación',
  'R-99-PN': 'No aplica – Otros',
} as const;

export type ResponsabilidadFiscal = keyof typeof RESPONSABILIDADES_FISCALES;

export const esResponsabilidadConocida = (codigo: string): codigo is ResponsabilidadFiscal => codigo in RESPONSABILIDADES_FISCALES;
