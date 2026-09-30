import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { aCentavos as $, PUC_SEMILLA, aceptaMovimientoEnPlantilla } from '@contafi/shared';
import { contextoDesdeCuentas, validarComprobante, type ConceptoRetencion } from '@contafi/motor';
import { leerDocumentoDian, leerZip, proponerAsiento, aprenderRegla, ErrorXmlDian, ErrorPropuesta } from '../src/index.ts';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ctx = contextoDesdeCuentas(PUC_SEMILLA.map((c) => ({
  codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza, aceptaMovimiento: aceptaMovimientoEnPlantilla(c.codigo),
  exigeTercero: c.exigeTercero, exigeCentroCosto: false, activa: true,
})));
const P = { anio: 2026, uvt: $('52374') }; // valor de ejemplo; el real viene de parametros_anuales
const RF: ConceptoRetencion = { tipo: 'RETEFUENTE', codigo: 'RF-COMPRAS', nombre: 'Retención compras 2,5 %', tarifa: 25_000n, baseMinimaUvt: '10', cuenta: '236540' };
const RICA: ConceptoRetencion = { tipo: 'RETEICA', codigo: 'RICA', nombre: 'ReteICA 4,14 por mil', tarifa: 4_140n, baseMinimaUvt: '0', cuenta: '236801' };

describe('lectura de AttachedDocument (factura de compra)', () => {
  const d = leerDocumentoDian(fixture('factura-compra-attached.xml'));

  it('extrae cabecera, partes y validación DIAN', () => {
    expect(d).toMatchObject({
      tipo: 'factura', numero: 'SN-10457', fechaEmision: '2026-09-15', fechaVencimiento: '2026-10-15', moneda: 'COP', codigoTipo: '01',
    });
    expect(d.cufe).toHaveLength(96);
    expect(d.emisor).toMatchObject({ nit: '901223556', dv: '9', tipoDocumento: '31', razonSocial: 'IMPORTADORA SUMINISTROS DEL NORTE S.A.S.', municipio: 'Medellín', codigoMunicipio: '05001', responsabilidades: ['O-13', 'O-15'] });
    expect(d.adquiriente).toMatchObject({ nit: '900123456', dv: '8' });
    expect(d.validacionDian).toEqual({ codigo: '02', descripcion: 'Documento validado por la DIAN' });
    expect(d.advertencias).toEqual([]);
  });

  it('extrae totales, impuestos por tarifa, retenciones y líneas en centavos exactos', () => {
    expect(d.subtotal).toBe($('1060000'));
    expect(d.totalAPagar).toBe($('1254400'));
    expect(d.impuestos.map((i) => [i.codigo, i.tarifa, i.base, i.valor])).toEqual([
      ['01', 190_000n, $('1010000'), $('191900')],
      ['01', 50_000n, $('50000'), $('2500')],
    ]);
    expect(d.retenciones[0]).toMatchObject({ codigo: '06', tarifa: 25_000n, valor: $('26500') });
    expect(d.lineas).toHaveLength(3);
    expect(d.lineas[0]).toMatchObject({ descripcion: 'Resma papel carta 75 g', codigoProducto: 'PAP-075', cantidad: '10', unidad: '94', valorUnitario: $('25000') });
    expect(d.lineas[2]?.unidad).toBe('KGM');
  });

  it('propone el asiento de compra con retenciones y cuadra', () => {
    const p = proponerAsiento(d, { nitEmpresa: '900.123.456-8', parametros: P, retenciones: [RF, RICA], terceroId: 'T-PROV' });
    expect(p.sentido).toBe('compra');
    expect(p.tipoComprobante).toBe('FC');
    expect(p.claveDuplicado).toBe(d.cufe);
    expect(validarComprobante(p, ctx)).toEqual([]);
    const por = (c: string) => p.lineas.filter((l) => l.cuenta === c);
    expect(por('519595')[0]?.debito).toBe($('1060000'));
    expect(por('240810').map((l) => l.debito)).toEqual([$('191900'), $('2500')]);
    expect(por('236540')[0]?.credito).toBe($('26500'));
    expect(por('236801')[0]?.credito).toBe($('4388.40'));
    expect(por('220505')[0]?.credito).toBe($('1223511.60'));
    expect(p.advertencias).toEqual([]);
  });

  it('usa la cuenta aprendida para el proveedor', () => {
    const reglas = aprenderRegla({}, '901.223.556-9', '519530');
    const p = proponerAsiento(d, { nitEmpresa: '900123456', parametros: P, reglas });
    expect(p.cuentaSugerida).toEqual({ cuenta: '519530', origen: 'regla' });
    expect(p.lineas[0]?.cuenta).toBe('519530');
    expect(p.advertencias.join(' ')).toMatch(/XML informa retenciones/);
  });

  it('el mismo documento, visto por el emisor, es una venta', () => {
    const p = proponerAsiento(d, { nitEmpresa: '901223556', parametros: P, terceroId: 'T-CLI' });
    expect(p.sentido).toBe('venta');
    expect(validarComprobante(p, ctx)).toEqual([]);
    expect(p.lineas.find((l) => l.cuenta === '130505')?.debito).toBe($('1254400'));
    expect(p.lineas.filter((l) => l.cuenta === '240805')).toHaveLength(2);
  });

  it('rechaza documentos de otra empresa', () => {
    expect(() => proponerAsiento(d, { nitEmpresa: '800197268', parametros: P })).toThrow(ErrorPropuesta);
  });
});

describe('nota crédito', () => {
  it('lee la referencia a la factura e invierte el asiento', () => {
    const d = leerDocumentoDian(fixture('nota-credito.xml'));
    expect(d).toMatchObject({ tipo: 'nota_credito', numero: 'NC-311', codigoTipo: '91', referencia: { numero: 'SN-10457', fecha: '2026-09-15' } });
    const p = proponerAsiento(d, { nitEmpresa: '900123456', parametros: P, terceroId: 'T-PROV' });
    expect(p.tipoComprobante).toBe('NC');
    expect(validarComprobante(p, ctx)).toEqual([]);
    expect(p.lineas.find((l) => l.cuenta === '220505')?.debito).toBe($('452200'));
    expect(p.lineas.find((l) => l.cuenta === '240810')?.credito).toBe($('72200'));
  });
});

describe('ZIP y seguridad', () => {
  it('lee los XML de un ZIP e ignora el PDF', () => {
    const zip = zipSync({
      'ad0901223556.xml': strToU8(fixture('factura-compra-attached.xml')),
      'nc.xml': strToU8(fixture('nota-credito.xml')),
      'factura.pdf': strToU8('%PDF-1.4 ...'),
      'roto.xml': strToU8('<Invoice><cbc:ID>'),
    });
    const r = leerZip(zip);
    expect(r.map((x) => x.nombre).sort()).toEqual(['ad0901223556.xml', 'nc.xml', 'roto.xml']);
    expect(r.find((x) => x.nombre === 'roto.xml')?.error).toBeTruthy();
    expect(r.filter((x) => x.documento)).toHaveLength(2);
  });
  it('rechaza DOCTYPE (entidades externas / bomba XML)', () => {
    expect(() => leerDocumentoDian('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Invoice/>')).toThrow(ErrorXmlDian);
  });
  it('rechaza tipos no soportados', () => {
    expect(() => leerDocumentoDian('<Order><ID>1</ID></Order>')).toThrow(/no soportado/);
  });
  it('advierte si los totales no cuadran', () => {
    const xml = fixture('nota-credito.xml').replace('<cbc:PayableAmount currencyID="COP">452200.00', '<cbc:PayableAmount currencyID="COP">452300.00');
    const d = leerDocumentoDian(xml);
    expect(d.advertencias.join(' ')).toMatch(/total a pagar/);
  });
});
