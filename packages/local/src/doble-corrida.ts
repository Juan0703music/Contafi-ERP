import { aCentavos, type Centavos } from '@contafi/shared';
import type { FilaExterna } from '@contafi/motor';

/**
 * Lee el balance de prueba exportado por el software anterior (Excel guardado como CSV) para la doble
 * corrida. Cada programa exporta distinto: se reconocen los encabezados más comunes y los montos con
 * formato colombiano ("1.234.567,89") o inglés ("1,234,567.89"), con signo o entre paréntesis.
 */
export type ConvencionSaldo = 'naturaleza' | 'debito-credito';

export interface LecturaBalanceExterno {
  filas: FilaExterna[];
  errores: string[];
  /** Cómo se leyó el saldo: dos columnas (débito y crédito) o una sola (según la convención elegida). */
  columnas: 'saldo' | 'debito-credito';
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "1.234.567,89" · "1,234,567.89" · "-1234567" · "(1.234)" · "$ 1.234" → centavos. null si no es un monto. */
export function leerMontoExportado(texto: string): Centavos | null {
  let t = texto.trim().replace(/[$\s]/g, '');
  if (!t) return 0n;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (t.startsWith('-')) { negativo = !negativo; t = t.slice(1); }
  if (t.endsWith('-')) { negativo = !negativo; t = t.slice(0, -1); }
  if (!/^[\d.,]+$/.test(t)) return null;
  const ultPunto = t.lastIndexOf('.');
  const ultComa = t.lastIndexOf(',');
  let entero = t;
  let decimales = '';
  if (ultPunto >= 0 && ultComa >= 0) {
    const sep = ultPunto > ultComa ? '.' : ',';
    const i = t.lastIndexOf(sep);
    entero = t.slice(0, i); decimales = t.slice(i + 1);
  } else if (ultComa >= 0) {
    // Solo comas: decimal si hay una sola coma con 1 o 2 dígitos después; si no, son miles.
    const partes = t.split(',');
    if (partes.length === 2 && partes[1]!.length <= 2) { entero = partes[0]!; decimales = partes[1]!; }
  } else if (ultPunto >= 0) {
    const partes = t.split('.');
    if (partes.length === 2 && partes[1]!.length <= 2) { entero = partes[0]!; decimales = partes[1]!; }
  }
  entero = entero.replace(/[.,]/g, '');
  if (!/^\d+$/.test(entero || '0') || !/^\d{0,2}$/.test(decimales)) return null;
  const valor = aCentavos(`${entero || '0'}.${(decimales || '0').padEnd(2, '0')}`);
  return negativo ? -valor : valor;
}

/** Naturaleza por el código (la del PUC de la empresa si existe; si no, la de la clase). */
function naturaleza(codigo: string, naturalezas: Map<string, 'D' | 'C'>): 'D' | 'C' {
  for (let n = codigo.length; n >= 1; n--) {
    const d = naturalezas.get(codigo.slice(0, n));
    if (d) return d;
  }
  return ['2', '3', '4'].includes(codigo[0]!) ? 'C' : 'D';
}

export function leerBalanceExterno(
  texto: string, convencion: ConvencionSaldo, naturalezas: Map<string, 'D' | 'C'> = new Map(),
): LecturaBalanceExterno {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = [';', '\t', ','].find((s) => (lineas[0] ?? '').includes(s)) ?? ';';
  const celdas = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  // Encabezado: la primera fila cuya primera celda no es un código numérico.
  let iCuenta = 0, iNombre = 1, iSaldo = 2, iDeb = -1, iCred = -1;
  let inicio = 0;
  const enc = celdas(lineas[0] ?? '').map(sinTildes);
  if (enc.length && !/^\d+$/.test(enc[0]!)) {
    inicio = 1;
    const buscar = (...pistas: RegExp[]) => enc.findIndex((h) => pistas.some((p) => p.test(h)));
    iCuenta = Math.max(0, buscar(/^cuenta$/, /^codigo/, /cuenta/));
    iNombre = buscar(/nombre/, /descripcion/, /detalle/);
    iSaldo = buscar(/saldo final/, /nuevo saldo/, /saldo actual/, /^saldo$/);
    // "Saldo débito / Saldo crédito" son saldos; "Débitos / Créditos" son movimientos del período y solo
    // se usan si el archivo no trae ninguna columna de saldo.
    const saldoDeb = buscar(/saldo.*deb/);
    const saldoCred = buscar(/saldo.*cred/);
    if (saldoDeb >= 0 && saldoCred >= 0) { iDeb = saldoDeb; iCred = saldoCred; }
    else if (iSaldo < 0) { iDeb = buscar(/^debito/, /^debe$/); iCred = buscar(/^credito/, /^haber$/); }
    if (iSaldo < 0 && (iDeb < 0 || iCred < 0)) iSaldo = enc.length - 1;
  }
  const dosColumnas = iDeb >= 0 && iCred >= 0;
  const filas: FilaExterna[] = [];
  const errores: string[] = [];
  lineas.slice(inicio).forEach((l, j) => {
    const n = j + inicio + 1;
    const c = celdas(l);
    const cuenta = (c[iCuenta] ?? '').replace(/[.\s-]/g, '');
    if (!/^[1-9]\d*$/.test(cuenta)) return; // totales, títulos o filas vacías
    let saldo: Centavos | null;
    if (dosColumnas) {
      const d = leerMontoExportado(c[iDeb] ?? '');
      const k = leerMontoExportado(c[iCred] ?? '');
      saldo = d === null || k === null ? null : d - k;
    } else {
      const s = leerMontoExportado(c[iSaldo] ?? '');
      saldo = s === null ? null : convencion === 'naturaleza' && naturaleza(cuenta, naturalezas) === 'C' ? -s : s;
    }
    if (saldo === null) { errores.push(`Fila ${n}: no se entiende el saldo de la cuenta ${cuenta}.`); return; }
    filas.push({ cuenta, nombre: iNombre >= 0 ? c[iNombre] : undefined, saldo });
  });
  if (!filas.length && !errores.length) errores.push('El archivo no tiene cuentas con saldo.');
  return { filas, errores, columnas: dosColumnas ? 'debito-credito' : 'saldo' };
}
