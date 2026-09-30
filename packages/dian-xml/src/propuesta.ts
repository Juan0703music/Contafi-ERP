import { CUENTAS_POR_DEFECTO, limpiarNit, type Centavos } from '@contafi/shared';
import {
  calcularRetencion, type ConceptoRetencion, type Linea, type ParametrosAnuales, type ResultadoRetencion,
} from '@contafi/motor';
import type { DocumentoDian, ParteDian } from './tipos.ts';

export type Sentido = 'compra' | 'venta';

/** Cuenta de gasto/inventario que el contador eligió para cada proveedor (NIT → cuenta). */
export type ReglasProveedor = Readonly<Record<string, string>>;

/** "Aprende" la cuenta usada para un proveedor: devuelve las reglas actualizadas. */
export function aprenderRegla(reglas: ReglasProveedor, nitProveedor: string, cuenta: string): ReglasProveedor {
  return { ...reglas, [limpiarNit(nitProveedor)]: cuenta };
}

export interface OpcionesPropuesta {
  /** NIT de la empresa que se está contabilizando: define si el documento es compra o venta. */
  nitEmpresa: string;
  /** Id del tercero ya creado o encontrado en la base; si no se da, se usa el NIT. */
  terceroId?: string;
  parametros: ParametrosAnuales;
  reglas?: ReglasProveedor;
  /** Cuenta de ingreso (ventas) o gasto/inventario (compras) si no hay regla. */
  cuentaPorDefecto?: string;
  /** Solo compras: retenciones que la empresa practica a este proveedor. */
  retenciones?: readonly ConceptoRetencion[];
  /** Solo compras: false si la empresa no es responsable de IVA (el IVA va al costo). */
  ivaDescontable?: boolean;
  cuentas?: typeof CUENTAS_POR_DEFECTO;
}

export interface PropuestaAsiento {
  sentido: Sentido;
  tipoComprobante: 'FC' | 'FV' | 'NC' | 'ND';
  fecha: string;
  concepto: string;
  tercero: ParteDian;
  terceroId: string;
  lineas: Linea[];
  retenciones: ResultadoRetencion[];
  /** CUFE/CUDE: si ya existe en la empresa, es un duplicado. */
  claveDuplicado: string;
  cuentaSugerida: { cuenta: string; origen: 'regla' | 'defecto' };
  advertencias: string[];
}

export class ErrorPropuesta extends Error {
  override name = 'ErrorPropuesta';
}

const IVA = '01';

/**
 * Propone el asiento de un documento electrónico. Las cifras salen del XML validado por la DIAN
 * (no se recalculan); las retenciones de compra las calcula el motor con los conceptos de la empresa.
 * La propuesta siempre la revisa el contador antes de contabilizar.
 */
export function proponerAsiento(d: DocumentoDian, o: OpcionesPropuesta): PropuestaAsiento {
  const cuentas = o.cuentas ?? CUENTAS_POR_DEFECTO;
  const nit = limpiarNit(o.nitEmpresa);
  const sentido: Sentido | null = limpiarNit(d.adquiriente.nit) === nit ? 'compra' : limpiarNit(d.emisor.nit) === nit ? 'venta' : null;
  if (!sentido) {
    throw new ErrorPropuesta(`El documento ${d.numero} no es de la empresa ${o.nitEmpresa}: emisor ${d.emisor.nit}, adquiriente ${d.adquiriente.nit}.`);
  }
  const tercero = sentido === 'compra' ? d.emisor : d.adquiriente;
  const t = o.terceroId ?? tercero.nit;
  const advertencias = [...d.advertencias];

  const regla = sentido === 'compra' ? o.reglas?.[limpiarNit(tercero.nit)] : undefined;
  const cuentaBase = regla ?? o.cuentaPorDefecto ?? (sentido === 'compra' ? cuentas.gastoCompras : cuentas.ingresoVentas);

  const ivaPorTarifa = d.impuestos.filter((i) => i.codigo === IVA && i.valor !== 0n);
  const otros = d.impuestos.filter((i) => i.codigo !== IVA && i.valor !== 0n);
  const totalIva = ivaPorTarifa.reduce((s, i) => s + i.valor, 0n);
  const totalOtros = otros.reduce((s, i) => s + i.valor, 0n);
  for (const i of otros) advertencias.push(`Impuesto ${i.codigo} ${i.nombre} por ${i.valor} centavos: verificar su tratamiento.`);

  const neto = d.subtotal - d.descuentos + d.cargos;
  const lineas: Linea[] = [];
  const deb = (cuenta: string, v: Centavos, nota: string, base?: Centavos | null) => { if (v !== 0n) lineas.push({ cuenta, terceroId: t, debito: v, credito: 0n, nota, base: base ?? null }); };
  const cred = (cuenta: string, v: Centavos, nota: string, base?: Centavos | null) => { if (v !== 0n) lineas.push({ cuenta, terceroId: t, debito: 0n, credito: v, nota, base: base ?? null }); };

  let retenciones: ResultadoRetencion[] = [];
  let lineaAjustable: Linea | undefined;

  if (sentido === 'compra') {
    const descontable = o.ivaDescontable ?? true;
    deb(cuentaBase, neto + totalOtros + (descontable ? 0n : totalIva), `Compra ${d.numero}`);
    lineaAjustable = lineas[lineas.length - 1];
    if (descontable) for (const i of ivaPorTarifa) deb(cuentas.ivaDescontable, i.valor, `IVA descontable ${tarifaTexto(i.tarifa)}`, i.base);
    const base = d.baseGravable > 0n ? d.baseGravable : neto;
    retenciones = (o.retenciones ?? []).map((r) => calcularRetencion(r, { subtotal: base, iva: totalIva }, o.parametros)).filter((r) => r.aplica);
    for (const r of retenciones) cred(r.cuenta, r.valor, `${r.nombre} practicada`, r.base);
    cred(cuentas.anticiposProveedores, d.anticipos, 'Cruce de anticipo');
    cred(cuentas.proveedores, d.totalAPagar - retenciones.reduce((s, r) => s + r.valor, 0n), `Por pagar ${d.numero}`);
    if (d.retenciones.length && !o.retenciones?.length) {
      advertencias.push('El XML informa retenciones pero no se configuraron retenciones para este proveedor. Revísalas.');
    }
  } else {
    deb(cuentas.clientes, d.totalAPagar, `Cartera ${d.numero}`);
    deb(cuentas.anticiposClientes, d.anticipos, 'Cruce de anticipo');
    cred(cuentaBase, neto, `Venta ${d.numero}`);
    lineaAjustable = lineas[lineas.length - 1];
    for (const i of ivaPorTarifa) cred(cuentas.ivaGenerado, i.valor, `IVA generado ${tarifaTexto(i.tarifa)}`, i.base);
    for (const i of otros) cred(cuentas.otrosImpuestosPorPagar, i.valor, `${i.nombre || i.codigo} ${tarifaTexto(i.tarifa)}`, i.base);
  }

  // Cuadre: el total del XML manda. La diferencia (redondeo u otra inconsistencia) va a la línea base.
  const deb_ = lineas.reduce((s, l) => s + l.debito, 0n);
  const cred_ = lineas.reduce((s, l) => s + l.credito, 0n);
  const diferencia = sentido === 'compra' ? cred_ - deb_ : deb_ - cred_;
  if (diferencia !== 0n) {
    if (diferencia !== d.redondeo) advertencias.push(`Se ajustaron ${diferencia} centavos en la cuenta ${cuentaBase} para cuadrar con el total del XML.`);
    if (lineaAjustable) {
      if (sentido === 'compra') lineaAjustable.debito += diferencia; else lineaAjustable.credito += diferencia;
    }
  }

  // Notas crédito: invierten el sentido del documento original.
  const invertir = d.tipo === 'nota_credito';
  const lineasFinales = invertir
    ? lineas.map((l) => ({ ...l, debito: l.credito, credito: l.debito, nota: `Nota crédito — ${l.nota ?? ''}` }))
    : lineas;
  if (lineasFinales.some((l) => l.debito < 0n || l.credito < 0n)) {
    advertencias.push('El asiento propuesto tiene valores negativos; el documento requiere revisión manual.');
  }

  const tipoComprobante = d.tipo === 'nota_credito' ? 'NC' : d.tipo === 'nota_debito' ? 'ND' : sentido === 'compra' ? 'FC' : 'FV';
  const nombreDoc = d.tipo === 'factura' ? 'Factura' : d.tipo === 'nota_credito' ? 'Nota crédito' : 'Nota débito';
  return {
    sentido,
    tipoComprobante,
    fecha: d.fechaEmision,
    concepto: `${nombreDoc} de ${sentido} ${d.numero} — ${tercero.razonSocial}`,
    tercero,
    terceroId: t,
    lineas: lineasFinales,
    retenciones,
    claveDuplicado: d.cufe,
    cuentaSugerida: { cuenta: cuentaBase, origen: regla ? 'regla' : 'defecto' },
    advertencias,
  };
}

function tarifaTexto(ppm: bigint | null): string {
  if (ppm === null) return '';
  const entero = ppm / 10_000n;
  const dec = (ppm % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${entero}${dec ? ',' + dec : ''} %`;
}
