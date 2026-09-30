import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import { aCentavos, esFechaValida, type Centavos, type TarifaPpm } from '@contafi/shared';
import type { DocumentoDian, ImpuestoDian, LineaDian, ParteDian, TipoDocumentoDian } from './tipos.ts';

type Nodo = Record<string, unknown>;

/** Elementos que pueden repetirse en UBL 2.1 y deben leerse siempre como lista. */
const LISTAS = new Set([
  'TaxTotal', 'TaxSubtotal', 'WithholdingTaxTotal', 'InvoiceLine', 'CreditNoteLine', 'DebitNoteLine',
  'PartyTaxScheme', 'PartyLegalEntity', 'BillingReference', 'DiscrepancyResponse', 'Attachment',
  'ParentDocumentLineReference', 'DocumentResponse', 'Description', 'Note', 'AllowanceCharge',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Nunca convertir a number: los montos se leen como texto y pasan a centavos exactos.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (nombre) => LISTAS.has(nombre),
});

export class ErrorXmlDian extends Error {
  override name = 'ErrorXmlDian';
}

const esNodo = (x: unknown): x is Nodo => typeof x === 'object' && x !== null && !Array.isArray(x);

function hijo(n: unknown, ...ruta: string[]): unknown {
  let actual: unknown = n;
  for (const paso of ruta) {
    if (Array.isArray(actual)) actual = actual[0];
    if (!esNodo(actual)) return undefined;
    actual = actual[paso];
  }
  return Array.isArray(actual) ? actual[0] : actual;
}

function lista(n: unknown, ...ruta: string[]): unknown[] {
  const padre = ruta.length > 1 ? hijo(n, ...ruta.slice(0, -1)) : n;
  if (!esNodo(padre)) return [];
  const v = padre[ruta[ruta.length - 1]!];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function texto(n: unknown, ...ruta: string[]): string | null {
  const v = ruta.length ? hijo(n, ...ruta) : n;
  if (typeof v === 'string') return v;
  if (esNodo(v) && typeof v['#text'] === 'string') return v['#text'];
  return null;
}

function atributo(n: unknown, attr: string, ...ruta: string[]): string | null {
  const v = hijo(n, ...ruta);
  return esNodo(v) && typeof v[`@_${attr}`] === 'string' ? (v[`@_${attr}`] as string) : null;
}

function monto(n: unknown, ...ruta: string[]): Centavos {
  const t = texto(n, ...ruta);
  if (t === null || t === '') return 0n;
  try {
    return aCentavos(t);
  } catch {
    throw new ErrorXmlDian(`Monto inválido en ${ruta.join('/')}: "${t}"`);
  }
}

/** "19.00" -> 190000 ppm; admite hasta 4 decimales ("0.9660"). */
function porcentajeAPpm(p: string | null): TarifaPpm | null {
  if (!p) return null;
  const m = /^(\d+)(?:\.(\d{1,4})\d*)?$/.exec(p.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

function leerParte(n: unknown): ParteDian {
  const party = hijo(n, 'Party');
  const pts = hijo(party, 'PartyTaxScheme');
  const ple = hijo(party, 'PartyLegalEntity');
  const idNodo = hijo(pts, 'CompanyID') ?? hijo(ple, 'CompanyID');
  const nit = texto(idNodo) ?? '';
  const direccion = hijo(pts, 'RegistrationAddress') ?? hijo(party, 'PhysicalLocation', 'Address');
  return {
    nit: nit.replace(/\D/g, '') || nit,
    dv: esNodo(idNodo) ? ((idNodo['@_schemeID'] as string | undefined) ?? null) : null,
    tipoDocumento: esNodo(idNodo) ? ((idNodo['@_schemeName'] as string | undefined) ?? null) : null,
    razonSocial: texto(pts, 'RegistrationName') ?? texto(ple, 'RegistrationName') ?? texto(party, 'PartyName', 'Name') ?? '',
    responsabilidades: (texto(pts, 'TaxLevelCode') ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    municipio: texto(direccion, 'CityName'),
    codigoMunicipio: texto(direccion, 'ID'),
    direccion: texto(direccion, 'AddressLine', 'Line'),
    correo: texto(party, 'Contact', 'ElectronicMail'),
  };
}

function leerImpuestos(n: unknown, elemento: 'TaxTotal' | 'WithholdingTaxTotal'): ImpuestoDian[] {
  const salida: ImpuestoDian[] = [];
  for (const total of lista(n, elemento)) {
    for (const sub of lista(total, 'TaxSubtotal')) {
      salida.push({
        codigo: texto(sub, 'TaxCategory', 'TaxScheme', 'ID') ?? '',
        nombre: texto(sub, 'TaxCategory', 'TaxScheme', 'Name') ?? '',
        tarifa: porcentajeAPpm(texto(sub, 'TaxCategory', 'Percent') ?? texto(sub, 'Percent')),
        base: monto(sub, 'TaxableAmount'),
        valor: monto(sub, 'TaxAmount'),
      });
    }
  }
  return salida;
}

function leerLineas(raiz: Nodo, tipo: TipoDocumentoDian): LineaDian[] {
  const [elemento, cantidadTag] = tipo === 'factura' ? ['InvoiceLine', 'InvoicedQuantity']
    : tipo === 'nota_credito' ? ['CreditNoteLine', 'CreditedQuantity'] : ['DebitNoteLine', 'DebitedQuantity'];
  return lista(raiz, elemento).map((l) => {
    const precio = texto(l, 'Price', 'PriceAmount');
    return {
      numero: texto(l, 'ID') ?? '',
      descripcion: texto(l, 'Item', 'Description') ?? '',
      codigoProducto: texto(l, 'Item', 'StandardItemIdentification', 'ID') ?? texto(l, 'Item', 'SellersItemIdentification', 'ID'),
      cantidad: texto(l, cantidadTag) ?? '1',
      unidad: atributo(l, 'unitCode', cantidadTag),
      valorUnitario: precio ? aCentavos(precio) : null,
      subtotal: monto(l, 'LineExtensionAmount'),
      impuestos: leerImpuestos(l, 'TaxTotal'),
    };
  });
}

function parsear(xml: string): Nodo {
  if (/<!DOCTYPE/i.test(xml)) throw new ErrorXmlDian('El XML contiene DOCTYPE; una factura UBL de la DIAN no lo usa. Se rechaza por seguridad.');
  try {
    return parser.parse(xml) as Nodo;
  } catch (e) {
    throw new ErrorXmlDian(`XML mal formado: ${(e as Error).message}`);
  }
}

/**
 * Lee un XML de la DIAN. Acepta el contenedor AttachedDocument (lo que llega por correo) o el
 * documento UBL directo (Invoice, CreditNote, DebitNote).
 */
export function leerDocumentoDian(xml: string): DocumentoDian {
  const doc = parsear(xml.replace(/^﻿/, ''));
  let validacionDian: DocumentoDian['validacionDian'] = null;

  let raizNombre = Object.keys(doc).find((k) => !k.startsWith('?'));
  let raiz = raizNombre ? doc[raizNombre] : undefined;

  if (raizNombre === 'AttachedDocument') {
    const interno = texto(raiz, 'Attachment', 'ExternalReference', 'Description');
    if (!interno) throw new ErrorXmlDian('El AttachedDocument no trae el documento electrónico en Attachment/ExternalReference/Description.');
    // Respuesta de validación de la DIAN (ApplicationResponse), si viene adjunta.
    const respuestaXml = texto(raiz, 'ParentDocumentLineReference', 'DocumentReference', 'Attachment', 'ExternalReference', 'Description');
    if (respuestaXml) {
      try {
        const r = parsear(respuestaXml)['ApplicationResponse'];
        const codigo = texto(r, 'DocumentResponse', 'Response', 'ResponseCode');
        if (codigo) validacionDian = { codigo, descripcion: texto(r, 'DocumentResponse', 'Response', 'Description') ?? '' };
      } catch { /* la respuesta es opcional */ }
    }
    const docInterno = parsear(interno.trim());
    raizNombre = Object.keys(docInterno).find((k) => !k.startsWith('?'));
    raiz = raizNombre ? docInterno[raizNombre] : undefined;
  }

  const tipo: TipoDocumentoDian | null = raizNombre === 'Invoice' ? 'factura'
    : raizNombre === 'CreditNote' ? 'nota_credito' : raizNombre === 'DebitNote' ? 'nota_debito' : null;
  if (!tipo || !esNodo(raiz)) {
    throw new ErrorXmlDian(`Tipo de documento no soportado: ${raizNombre ?? '(vacío)'}. Se esperaba Invoice, CreditNote, DebitNote o AttachedDocument.`);
  }

  const totales = tipo === 'nota_debito' ? (hijo(raiz, 'RequestedMonetaryTotal') ?? hijo(raiz, 'LegalMonetaryTotal')) : hijo(raiz, 'LegalMonetaryTotal');
  const fechaEmision = texto(raiz, 'IssueDate') ?? '';
  if (!esFechaValida(fechaEmision)) throw new ErrorXmlDian(`Fecha de emisión inválida: "${fechaEmision}"`);
  const fv = texto(raiz, 'DueDate') ?? texto(raiz, 'PaymentMeans', 'PaymentDueDate');

  const ref = hijo(raiz, 'BillingReference', 'InvoiceDocumentReference');
  const d: DocumentoDian = {
    tipo,
    numero: texto(raiz, 'ID') ?? '',
    cufe: texto(raiz, 'UUID') ?? '',
    fechaEmision,
    horaEmision: texto(raiz, 'IssueTime'),
    fechaVencimiento: fv && esFechaValida(fv) ? fv : null,
    tipoOperacion: texto(raiz, 'CustomizationID'),
    codigoTipo: texto(raiz, 'InvoiceTypeCode') ?? texto(raiz, 'CreditNoteTypeCode') ?? texto(raiz, 'DebitNoteTypeCode'),
    moneda: texto(raiz, 'DocumentCurrencyCode') ?? 'COP',
    emisor: leerParte(hijo(raiz, 'AccountingSupplierParty')),
    adquiriente: leerParte(hijo(raiz, 'AccountingCustomerParty')),
    subtotal: monto(totales, 'LineExtensionAmount'),
    baseGravable: monto(totales, 'TaxExclusiveAmount'),
    totalConImpuestos: monto(totales, 'TaxInclusiveAmount'),
    descuentos: monto(totales, 'AllowanceTotalAmount'),
    cargos: monto(totales, 'ChargeTotalAmount'),
    anticipos: monto(totales, 'PrepaidAmount'),
    redondeo: monto(totales, 'PayableRoundingAmount'),
    totalAPagar: monto(totales, 'PayableAmount'),
    impuestos: leerImpuestos(raiz, 'TaxTotal'),
    retenciones: leerImpuestos(raiz, 'WithholdingTaxTotal'),
    lineas: leerLineas(raiz, tipo),
    referencia: ref ? { numero: texto(ref, 'ID') ?? '', cufe: texto(ref, 'UUID'), fecha: texto(ref, 'IssueDate') } : null,
    validacionDian,
    advertencias: [],
  };
  d.advertencias = verificarTotales(d);
  return d;
}

/** Cruces de coherencia. No bloquean: el XML validado por la DIAN manda, pero el contador debe verlos. */
export function verificarTotales(d: DocumentoDian): string[] {
  const a: string[] = [];
  if (!d.cufe) a.push('El documento no tiene CUFE/CUDE: no se podrán detectar duplicados.');
  if (d.moneda !== 'COP') a.push(`El documento está en ${d.moneda}; el valor contable debe convertirse a pesos con la TRM.`);
  const sumaLineas = d.lineas.reduce((s, l) => s + l.subtotal, 0n);
  if (d.lineas.length && sumaLineas !== d.subtotal) {
    a.push(`La suma de las líneas (${sumaLineas}) no coincide con el subtotal (${d.subtotal}).`);
  }
  const impuestos = d.impuestos.reduce((s, i) => s + i.valor, 0n);
  if (d.totalConImpuestos && d.baseGravable + impuestos !== d.totalConImpuestos && d.subtotal + impuestos !== d.totalConImpuestos) {
    a.push(`Subtotal + impuestos (${d.subtotal + impuestos}) no coincide con el total con impuestos (${d.totalConImpuestos}).`);
  }
  const esperado = d.totalConImpuestos - d.descuentos + d.cargos - d.anticipos + d.redondeo;
  if (d.totalAPagar !== esperado) {
    a.push(`El total a pagar (${d.totalAPagar}) no coincide con total − descuentos + cargos − anticipos + redondeo (${esperado}).`);
  }
  if (d.validacionDian && d.validacionDian.codigo !== '02') {
    a.push(`La DIAN no reporta el documento como validado (código ${d.validacionDian.codigo}: ${d.validacionDian.descripcion}).`);
  }
  return a;
}

export interface ArchivoLeido {
  nombre: string;
  documento?: DocumentoDian;
  error?: string;
}

/** Lee un ZIP (como los que llegan por correo) y devuelve cada XML interpretado. Ignora PDF y otros. */
export function leerZip(bytes: Uint8Array): ArchivoLeido[] {
  const archivos = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.xml') && f.originalSize < 20 * 1024 * 1024 });
  return Object.entries(archivos).map(([nombre, contenido]) => {
    try {
      return { nombre, documento: leerDocumentoDian(strFromU8(contenido)) };
    } catch (e) {
      return { nombre, error: (e as Error).message };
    }
  });
}
