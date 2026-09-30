import {
  CUENTAS_POR_DEFECTO, dividirRedondeado, aplicarTarifa, type Centavos, type TarifaPpm,
} from '@contafi/shared';
import { calcularRetencion, type ConceptoRetencion, type IvaItem, type ParametrosAnuales, type ResultadoRetencion } from './impuestos.ts';
import { ErrorMotor } from './errores.ts';
import type { Linea } from './tipos.ts';

/** Cantidad como texto decimal ("2", "2.5", "0,125"). Se convierte a milésimas. */
export type Cantidad = string;

export function aMilesimas(cantidad: Cantidad): bigint {
  const s = cantidad.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: `Cantidad inválida: "${cantidad}" (máximo 3 decimales).` }]);
  const [e = '0', d = ''] = s.split('.');
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'));
}

export interface ItemDocumento {
  descripcion: string;
  cantidad: Cantidad;
  valorUnitario: Centavos;
  descuento?: Centavos;
  iva: IvaItem;
  /** Cuenta de ingreso (venta) o de inventario/gasto (compra). Por defecto, la de la empresa. */
  cuenta?: string;
  productoId?: string;
  /** Solo ventas de inventario: costo calculado por el kardex (costo promedio). */
  costo?: Centavos;
}

export interface ItemCalculado extends ItemDocumento {
  subtotal: Centavos; // cantidad × valor unitario − descuento
}

export interface SubtotalIva {
  tipo: 'gravado' | 'exento' | 'excluido';
  tarifa: TarifaPpm;
  base: Centavos;
  valor: Centavos;
}

export interface TotalesDocumento {
  items: ItemCalculado[];
  subtotal: Centavos;
  iva: SubtotalIva[];
  totalIva: Centavos;
  /** Total de la factura (subtotal + IVA), como en LegalMonetaryTotal/PayableAmount. */
  total: Centavos;
  retenciones: ResultadoRetencion[];
  totalRetenciones: Centavos;
  /** Lo que efectivamente se cobra o paga: total − retenciones. */
  neto: Centavos;
}

/**
 * Totales de un documento. Política de redondeo (regla 8): el subtotal de cada ítem se redondea a
 * centavos; el IVA se calcula y redondea por tarifa (TaxSubtotal del XML UBL), no por ítem.
 */
export function calcularTotales(
  items: readonly ItemDocumento[],
  retenciones: readonly ConceptoRetencion[],
  p: ParametrosAnuales,
): TotalesDocumento {
  if (items.length === 0) throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: 'El documento debe tener al menos un ítem.' }]);
  const calculados: ItemCalculado[] = items.map((it, i) => {
    if (it.valorUnitario < 0n || (it.descuento ?? 0n) < 0n) {
      throw new ErrorMotor([{ codigo: 'VALOR_NEGATIVO', linea: i, mensaje: `Ítem ${i + 1}: valores negativos.` }]);
    }
    const bruto = dividirRedondeado(aMilesimas(it.cantidad) * it.valorUnitario, 1000n);
    const subtotal = bruto - (it.descuento ?? 0n);
    if (subtotal < 0n) throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', linea: i, mensaje: `Ítem ${i + 1}: el descuento supera el valor.` }]);
    if (it.iva.tipo === 'gravado' && (it.iva.tarifa === undefined || it.iva.tarifa <= 0n)) {
      throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', linea: i, mensaje: `Ítem ${i + 1}: IVA gravado sin tarifa.` }]);
    }
    return { ...it, subtotal };
  });

  const grupos = new Map<string, SubtotalIva>();
  for (const it of calculados) {
    const tarifa = it.iva.tipo === 'gravado' ? it.iva.tarifa! : 0n;
    const clave = `${it.iva.tipo}:${tarifa}`;
    const g = grupos.get(clave) ?? { tipo: it.iva.tipo, tarifa, base: 0n, valor: 0n };
    g.base += it.subtotal;
    grupos.set(clave, g);
  }
  const iva = [...grupos.values()].map((g) => ({ ...g, valor: g.tipo === 'gravado' ? aplicarTarifa(g.base, g.tarifa) : 0n }));

  const subtotal = calculados.reduce((s, it) => s + it.subtotal, 0n);
  const totalIva = iva.reduce((s, g) => s + g.valor, 0n);
  const total = subtotal + totalIva;
  const rets = retenciones.map((r) => calcularRetencion(r, { subtotal, iva: totalIva }, p)).filter((r) => r.aplica);
  const totalRetenciones = rets.reduce((s, r) => s + r.valor, 0n);

  return { items: calculados, subtotal, iva, totalIva, total, retenciones: rets, totalRetenciones, neto: total - totalRetenciones };
}

type Cuentas = typeof CUENTAS_POR_DEFECTO;

const deb = (cuenta: string, valor: Centavos, terceroId: string, nota: string, base?: Centavos): Linea =>
  ({ cuenta, terceroId, debito: valor, credito: 0n, nota, base: base ?? null });
const cred = (cuenta: string, valor: Centavos, terceroId: string, nota: string, base?: Centavos): Linea =>
  ({ cuenta, terceroId, debito: 0n, credito: valor, nota, base: base ?? null });

/** Agrupa líneas iguales (misma cuenta, tercero, lado y nota) y quita las de valor cero. */
function compactar(lineas: Linea[]): Linea[] {
  const salida: Linea[] = [];
  for (const l of lineas) {
    if (l.debito === 0n && l.credito === 0n) continue;
    const igual = salida.find((x) => x.cuenta === l.cuenta && x.terceroId === l.terceroId && x.nota === l.nota
      && (x.debito > 0n) === (l.debito > 0n));
    if (igual) {
      igual.debito += l.debito;
      igual.credito += l.credito;
      if (l.base != null) igual.base = (igual.base ?? 0n) + l.base;
    } else {
      salida.push({ ...l });
    }
  }
  return salida;
}

/**
 * Asiento de una factura de venta.
 * Débito: clientes (neto), retenciones que nos practican (a favor), costo de ventas.
 * Crédito: ingresos por ítem, IVA generado, inventario.
 * Las retenciones que recibe deben tener cuentas de activo (1355xx).
 */
export function asientoFacturaVenta(
  t: TotalesDocumento, terceroId: string, cuentas: Cuentas = CUENTAS_POR_DEFECTO,
): Linea[] {
  const lineas: Linea[] = [deb(cuentas.clientes, t.neto, terceroId, 'Cartera cliente')];
  for (const r of t.retenciones) lineas.push(deb(r.cuenta, r.valor, terceroId, `${r.nombre} que nos practican`, r.base));
  for (const it of t.items) lineas.push(cred(it.cuenta ?? cuentas.ingresoVentas, it.subtotal, terceroId, 'Ingreso'));
  for (const g of t.iva) if (g.valor > 0n) lineas.push(cred(cuentas.ivaGenerado, g.valor, terceroId, `IVA generado ${Number(g.tarifa) / 10_000} %`, g.base));
  for (const it of t.items) {
    if (it.costo && it.costo > 0n) {
      lineas.push(deb(cuentas.costoVentas, it.costo, terceroId, 'Costo de ventas'));
      lineas.push(cred(cuentas.inventario, it.costo, terceroId, 'Salida de inventario'));
    }
  }
  return compactar(lineas);
}

/**
 * Asiento de una factura de compra (o documento soporte).
 * Débito: inventario/gasto por ítem, IVA descontable (o mayor valor del costo).
 * Crédito: proveedor (neto) y retenciones que practicamos (por pagar, 236xxx).
 */
export function asientoFacturaCompra(
  t: TotalesDocumento, terceroId: string,
  opciones: { ivaDescontable?: boolean; cuentaPorDefecto?: string } = {}, cuentas: Cuentas = CUENTAS_POR_DEFECTO,
): Linea[] {
  const ivaDescontable = opciones.ivaDescontable ?? true;
  const lineas: Linea[] = [];
  if (ivaDescontable) {
    for (const it of t.items) lineas.push(deb(it.cuenta ?? opciones.cuentaPorDefecto ?? cuentas.gastoCompras, it.subtotal, terceroId, 'Compra'));
    for (const g of t.iva) if (g.valor > 0n) lineas.push(deb(cuentas.ivaDescontable, g.valor, terceroId, `IVA descontable ${Number(g.tarifa) / 10_000} %`, g.base));
  } else {
    // IVA como mayor valor del costo o gasto: se prorratea sobre los ítems gravados.
    for (const it of t.items) {
      const g = t.iva.find((x) => x.tipo === it.iva.tipo && x.tarifa === (it.iva.tarifa ?? 0n));
      const ivaItem = g && g.base > 0n ? dividirRedondeado(g.valor * it.subtotal, g.base) : 0n;
      lineas.push(deb(it.cuenta ?? opciones.cuentaPorDefecto ?? cuentas.gastoCompras, it.subtotal + ivaItem, terceroId, 'Compra (IVA mayor valor)'));
    }
    // Ajuste de centavos del prorrateo contra la primera línea.
    const diferencia = t.total - lineas.reduce((s, l) => s + l.debito, 0n);
    if (lineas[0]) lineas[0].debito += diferencia;
  }
  for (const r of t.retenciones) lineas.push(cred(r.cuenta, r.valor, terceroId, `${r.nombre} practicada`, r.base));
  lineas.push(cred(cuentas.proveedores, t.neto, terceroId, 'Cuenta por pagar proveedor'));
  return compactar(lineas);
}

/** Nota crédito de venta (devolución): invierte el asiento usando la cuenta de devoluciones para el ingreso. */
export function asientoNotaCreditoVenta(
  t: TotalesDocumento, terceroId: string, cuentas: Cuentas = CUENTAS_POR_DEFECTO,
): Linea[] {
  const itemsDevolucion = t.items.map((it) => ({ ...it, cuenta: cuentas.devolucionesVentas }));
  return asientoFacturaVenta({ ...t, items: itemsDevolucion }, terceroId, cuentas)
    .map((l) => ({ ...l, debito: l.credito, credito: l.debito }));
}

export function asientoRecaudo(valor: Centavos, terceroId: string, cuentaBanco: string, cuentas: Cuentas = CUENTAS_POR_DEFECTO): Linea[] {
  return [deb(cuentaBanco, valor, terceroId, 'Ingreso a banco'), cred(cuentas.clientes, valor, terceroId, 'Abono cartera')];
}

export function asientoPago(valor: Centavos, terceroId: string, cuentaBanco: string, cuentas: Cuentas = CUENTAS_POR_DEFECTO): Linea[] {
  return [deb(cuentas.proveedores, valor, terceroId, 'Pago a proveedor'), cred(cuentaBanco, valor, terceroId, 'Salida de banco')];
}
