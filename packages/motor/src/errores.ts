export type CodigoError =
  | 'MENOS_DE_DOS_LINEAS'
  | 'DEBITO_Y_CREDITO'
  | 'VALOR_NEGATIVO'
  | 'LINEA_EN_CERO'
  | 'DESCUADRADO'
  | 'TOTAL_CERO'
  | 'CUENTA_INEXISTENTE'
  | 'CUENTA_NO_ACEPTA_MOVIMIENTO'
  | 'CUENTA_INACTIVA'
  | 'FALTA_TERCERO'
  | 'FALTA_CENTRO_COSTO'
  | 'FECHA_INVALIDA'
  | 'PERIODO_CERRADO'
  | 'CONCEPTO_VACIO'
  | 'YA_ANULADO'
  | 'NO_CONTABILIZADO'
  | 'STOCK_INSUFICIENTE'
  | 'DATO_INVALIDO';

export interface ErrorContable {
  codigo: CodigoError;
  mensaje: string;
  /** Índice de la línea (base 0) cuando el error es de una línea. */
  linea?: number;
}

export class ErrorMotor extends Error {
  readonly errores: ErrorContable[];
  constructor(errores: ErrorContable[]) {
    super(errores.map((e) => e.mensaje).join(' '));
    this.name = 'ErrorMotor';
    this.errores = errores;
  }
}
