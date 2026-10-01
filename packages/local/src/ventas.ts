import type { Centavos, FechaISO } from '@contafi/shared';
import {
  antiguedadSaldos, aMilesimas, asientoFacturaCompra, asientoFacturaVenta, asientoPago, asientoRecaudo, calcularTotales, kardex, salida,
  type AntiguedadTercero, type EstadoInventario, type ItemDocumento, type TotalesDocumento,
} from '@contafi/motor';
import type { BaseLocal } from './base.ts';
import { ErrorLocal, comprobantesParaReportes, crearComprobante } from './contabilidad.ts';
import { conceptosRetencion, parametrosDelAnio } from './retenciones.ts';
import { productosLocales } from './inventario.ts';

/**
 * Ventas y compras registradas a mano (sección 11.1): facturas no electrónicas o de proveedores sin
 * XML, recaudos y pagos. Los cálculos (subtotales, IVA por tarifa, retenciones con base en UVT y el
 * asiento) los hace el motor, igual que en la importación de la DIAN.
 */
export interface DatosFactura {
  sentido: 'venta' | 'compra';
  terceroId: string;
  fecha: FechaISO;
  /** Número de la factura (del proveedor o propio), para el concepto y la búsqueda. */
  numero: string;
  items: ItemDocumento[];
  /** Códigos de los conceptos de retención configurados que se aplican. */
  retenciones: string[];
  /** Compras de no responsables de IVA: el IVA va al costo o gasto. */
  ivaDescontable?: boolean;
}

export async function calcularFactura(base: BaseLocal, empresa: string, d: DatosFactura): Promise<TotalesDocumento> {
  const anio = Number(d.fecha.slice(0, 4));
  const conceptos = (await conceptosRetencion(base, empresa, true))
    .filter((c) => c.aplicaEn === (d.sentido === 'venta' ? 'ventas' : 'compras') && d.retenciones.includes(c.codigo));
  const parametros = await parametrosDelAnio(base, anio);
  if (conceptos.length && !parametros) {
    throw new ErrorLocal('FALTA_UVT', `Configure la UVT de ${anio} en Impuestos y retenciones para calcular las retenciones.`);
  }
  return calcularTotales(d.items, conceptos, parametros ?? { anio, uvt: 0n });
}

/**
 * Ítems con producto de inventario: la cuenta de inventario del producto y, en ventas, el costo con el
 * promedio del kárdex. Una venta sin conexión puede dejar la existencia negativa (sección 9.4): se
 * permite y se avisa.
 */
async function prepararInventario(base: BaseLocal, empresa: string, d: DatosFactura): Promise<{ items: ItemDocumento[]; avisos: string[] }> {
  const conProducto = d.items.filter((i) => i.productoId);
  if (!conProducto.length) return { items: d.items, avisos: [] };
  const productos = new Map((await productosLocales(base, empresa)).map((p) => [p.id, p]));
  const cs = await comprobantesParaReportes(base, empresa, { incluirPendientes: true });
  const estados = new Map<string, EstadoInventario>();
  const avisos: string[] = [];
  const items = d.items.map((it) => {
    if (!it.productoId) return it;
    const p = productos.get(it.productoId);
    if (!p) throw new ErrorLocal('NO_EXISTE', `El producto del ítem "${it.descripcion}" no existe.`);
    if (p.tipo === 'servicio') return { ...it, productoId: undefined }; // los servicios no llevan kárdex
    if (d.sentido === 'compra') return { ...it, cuentaInventario: p.cuentaInventario };
    const estado = estados.get(p.id) ?? kardex(cs, p.id).estado;
    const r = salida(estado, aMilesimas(it.cantidad), { permitirNegativo: true });
    estados.set(p.id, r.estado);
    if (r.quedoNegativo) avisos.push(`La existencia de ${p.nombre} queda negativa (${Number(r.estado.cantidad) / 1000} ${p.unidad}).`);
    return { ...it, cuentaInventario: p.cuentaInventario, costo: r.costo };
  });
  return { items, avisos };
}

export async function crearFactura(base: BaseLocal, empresa: string, d: DatosFactura): Promise<{ id: string; numeroLocal: string; totales: TotalesDocumento; avisos: string[] }> {
  if (!d.numero.trim()) throw new ErrorLocal('DATOS_INVALIDOS', 'Escriba el número de la factura.');
  const { items, avisos } = await prepararInventario(base, empresa, d);
  const totales = await calcularFactura(base, empresa, { ...d, items });
  const lineas = d.sentido === 'venta'
    ? asientoFacturaVenta(totales, d.terceroId)
    : asientoFacturaCompra(totales, d.terceroId, { ivaDescontable: d.ivaDescontable ?? true });
  const [t] = await base.consultar<{ nombre: string }>('select nombre from terceros where id = ?', [d.terceroId]);
  const r = await crearComprobante(base, empresa, {
    tipo: d.sentido === 'venta' ? 'FV' : 'FC', fecha: d.fecha, origen: d.sentido === 'venta' ? 'factura_venta' : 'factura_compra', lineas,
    concepto: `Factura de ${d.sentido} ${d.numero.trim()} — ${t?.nombre ?? 'tercero'}`,
  });
  return { ...r, totales, avisos };
}

/** Recaudo de un cliente (o pago a un proveedor) contra la cuenta de caja o bancos elegida. */
export async function registrarMovimientoTercero(
  base: BaseLocal, empresa: string,
  d: { tipo: 'recaudo' | 'pago'; terceroId: string; fecha: FechaISO; valor: Centavos; cuentaBanco: string; referencia?: string },
): Promise<{ id: string; numeroLocal: string }> {
  if (d.valor <= 0n) throw new ErrorLocal('DATOS_INVALIDOS', 'El valor debe ser mayor que cero.');
  const [t] = await base.consultar<{ nombre: string }>('select nombre from terceros where id = ?', [d.terceroId]);
  const lineas = d.tipo === 'recaudo' ? asientoRecaudo(d.valor, d.terceroId, d.cuentaBanco) : asientoPago(d.valor, d.terceroId, d.cuentaBanco);
  return crearComprobante(base, empresa, {
    tipo: d.tipo === 'recaudo' ? 'RC' : 'CE', fecha: d.fecha, origen: d.tipo, lineas,
    concepto: `${d.tipo === 'recaudo' ? 'Recaudo de' : 'Pago a'} ${t?.nombre ?? 'tercero'}${d.referencia?.trim() ? ` — ${d.referencia.trim()}` : ''}`,
  });
}

export interface FilaAntiguedad extends AntiguedadTercero {
  nombre: string;
}

/** Cartera por edades (1305) o cuentas por pagar (2205), incluyendo lo pendiente de sincronizar. */
export async function antiguedadLocal(base: BaseLocal, empresa: string, que: 'cartera' | 'por_pagar', corte: FechaISO): Promise<FilaAntiguedad[]> {
  const cs = await comprobantesParaReportes(base, empresa, { incluirPendientes: true });
  const nombres = new Map((await base.consultar<{ id: string; nombre: string }>('select id, nombre from terceros where empresa_id = ?', [empresa])).map((t) => [t.id, t.nombre]));
  return antiguedadSaldos(cs, que === 'cartera' ? '1305' : '2205', que === 'cartera' ? 'D' : 'C', corte)
    .map((x) => ({ ...x, nombre: nombres.get(x.terceroId) ?? '(tercero)' }));
}
