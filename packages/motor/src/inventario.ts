import { dividirRedondeado, type Centavos } from '@contafi/shared';
import { ErrorMotor } from './errores.ts';

/**
 * Kardex por costo promedio ponderado.
 * Se guarda el VALOR total del inventario (no solo el costo unitario) para no perder centavos:
 * cuando sale todo, el costo de la salida es exactamente el valor restante.
 * Cantidades en milésimas (ver aMilesimas).
 */
export interface EstadoInventario {
  cantidad: bigint;
  valor: Centavos;
  /** Último costo unitario conocido (por unidad entera), para salidas con existencia negativa. */
  costoUnitario: Centavos;
}

export const INVENTARIO_VACIO: EstadoInventario = { cantidad: 0n, valor: 0n, costoUnitario: 0n };

export function costoPromedio(e: EstadoInventario): Centavos {
  return e.cantidad > 0n ? dividirRedondeado(e.valor * 1000n, e.cantidad) : e.costoUnitario;
}

export function entrada(e: EstadoInventario, cantidad: bigint, costoTotal: Centavos): EstadoInventario {
  if (cantidad <= 0n || costoTotal < 0n) {
    throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: 'La entrada debe tener cantidad positiva y costo no negativo.' }]);
  }
  const nuevo = { cantidad: e.cantidad + cantidad, valor: e.valor + costoTotal, costoUnitario: e.costoUnitario };
  nuevo.costoUnitario = nuevo.cantidad > 0n ? dividirRedondeado(nuevo.valor * 1000n, nuevo.cantidad) : dividirRedondeado(costoTotal * 1000n, cantidad);
  return nuevo;
}

/**
 * Salida al costo promedio. Con `permitirNegativo` (ventas sin conexión, sección 9.4) la salida que
 * supera la existencia se costea al último costo unitario y el servidor genera una alerta.
 */
export function salida(
  e: EstadoInventario, cantidad: bigint, opciones: { permitirNegativo?: boolean } = {},
): { estado: EstadoInventario; costo: Centavos; quedoNegativo: boolean } {
  if (cantidad <= 0n) throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: 'La salida debe tener cantidad positiva.' }]);
  if (cantidad > e.cantidad && !opciones.permitirNegativo) {
    throw new ErrorMotor([{
      codigo: 'STOCK_INSUFICIENTE',
      mensaje: `Existencia insuficiente: disponible ${Number(e.cantidad) / 1000}, solicitado ${Number(cantidad) / 1000}.`,
    }]);
  }
  let costo: Centavos;
  if (e.cantidad > 0n && cantidad <= e.cantidad) {
    costo = cantidad === e.cantidad ? e.valor : dividirRedondeado(e.valor * cantidad, e.cantidad);
  } else {
    const disponible = e.cantidad > 0n ? e.cantidad : 0n;
    const valorDisponible = e.cantidad > 0n ? e.valor : 0n;
    costo = valorDisponible + dividirRedondeado((cantidad - disponible) * e.costoUnitario, 1000n);
  }
  const estado = { cantidad: e.cantidad - cantidad, valor: e.valor - costo, costoUnitario: e.costoUnitario };
  return { estado, costo, quedoNegativo: estado.cantidad < 0n };
}
