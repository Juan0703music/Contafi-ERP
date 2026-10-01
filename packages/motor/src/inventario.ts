import { dividirRedondeado, type Centavos } from '@contafi/shared';
import { ErrorMotor } from './errores.ts';
import { EN_LIBROS, type Comprobante } from './tipos.ts';

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

// ------------------------------------------------------------------ kárdex derivado de los comprobantes


export interface MovimientoKardex {
  comprobanteId: string;
  numero: string | null;
  fecha: string;
  concepto: string;
  tipo: 'entrada' | 'salida';
  cantidad: bigint;
  valor: Centavos;
  saldoCantidad: bigint;
  saldoValor: Centavos;
  costoPromedio: Centavos;
}

/**
 * Kárdex de un producto calculado a partir de las líneas contables que lo mencionan: débito = entrada,
 * crédito = salida. Como sale de los comprobantes, todos los PC llegan al mismo kárdex al sincronizar.
 */
export function kardex(comprobantes: readonly Comprobante[], productoId: string): { movimientos: MovimientoKardex[]; estado: EstadoInventario } {
  const filas: { c: Comprobante; cantidad: bigint; debito: bigint; credito: bigint }[] = [];
  for (const c of comprobantes) {
    if (!EN_LIBROS.has(c.estado)) continue;
    for (const l of c.lineas) {
      if (l.productoId === productoId && l.cantidad) filas.push({ c, cantidad: l.cantidad, debito: l.debito, credito: l.credito });
    }
  }
  filas.sort((a, b) => a.c.fecha.localeCompare(b.c.fecha) || (a.c.numero ?? '').localeCompare(b.c.numero ?? ''));
  let estado: EstadoInventario = INVENTARIO_VACIO;
  const movimientos = filas.map((f) => {
    const entrada = f.debito > 0n;
    // El valor de cada movimiento es el que quedó contabilizado (no se recalcula): libros y kárdex coinciden.
    estado = entrada
      ? { cantidad: estado.cantidad + f.cantidad, valor: estado.valor + f.debito, costoUnitario: estado.costoUnitario }
      : { cantidad: estado.cantidad - f.cantidad, valor: estado.valor - f.credito, costoUnitario: estado.costoUnitario };
    if (estado.cantidad > 0n) estado.costoUnitario = dividirRedondeado(estado.valor * 1000n, estado.cantidad);
    return {
      comprobanteId: f.c.id, numero: f.c.numero, fecha: f.c.fecha, concepto: f.c.concepto, tipo: entrada ? 'entrada' as const : 'salida' as const,
      cantidad: f.cantidad, valor: entrada ? f.debito : f.credito, saldoCantidad: estado.cantidad, saldoValor: estado.valor, costoPromedio: estado.costoUnitario,
    };
  });
  return { movimientos, estado };
}
