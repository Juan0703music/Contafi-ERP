import { calcularDV, limpiarNit } from '@contafi/shared';
import { TIPOS_TERCERO, terceroSync } from '@contafi/sync';
import type { BaseLocal } from './base.ts';
import { ErrorLocal, crearTercero, type DatosTercero } from './contabilidad.ts';

export const PLANTILLA_TERCEROS = [
  'tipo_documento;numero;dv;nombre;tipos;correo;municipio;direccion',
  'NIT;830945221;8;Distribuciones El Roble S.A.S.;cliente;compras@elroble.co;Bogotá;Cra 15 # 93-47',
  'CC;1032556789;;Laura Restrepo Gómez;cliente,empleado;;Medellín;',
].join('\r\n');

const TIPOS_DOC: Record<string, string> = { NIT: '31', CC: '13', CE: '22', PASAPORTE: '41', PA: '41', TI: '12', '31': '31', '13': '13', '22': '22', '41': '41', '12': '12' };

export interface LecturaTerceros {
  terceros: DatosTercero[];
  errores: string[];
}

/**
 * Lee terceros desde CSV (Excel en español usa ";"). Valida tipo de documento, dígito de verificación
 * de los NIT (lo calcula si viene vacío), nombre, tipos y correo, fila por fila.
 */
export function leerTercerosCsv(texto: string): LecturaTerceros {
  const filas = texto.replace(/^﻿/, '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const sep = (filas[0] ?? '').includes(';') ? ';' : ',';
  const terceros: DatosTercero[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  filas.forEach((fila, i) => {
    const n = i + 1;
    const [tipoDoc = '', numero = '', dv = '', nombre = '', tipos = '', correo = '', municipio = '', direccion = ''] =
      fila.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /tipo/i.test(tipoDoc)) return; // encabezado
    const td = TIPOS_DOC[tipoDoc.toUpperCase()];
    if (!td) { errores.push(`Fila ${n}: tipo de documento "${tipoDoc}" no reconocido (use NIT, CC, CE, PASAPORTE o TI).`); return; }
    const num = td === '31' || td === '13' ? limpiarNit(numero) : numero.replace(/\s/g, '');
    if (!/^[0-9A-Za-z]{3,20}$/.test(num)) { errores.push(`Fila ${n}: número de documento inválido "${numero}".`); return; }
    if (!nombre) { errores.push(`Fila ${n}: falta el nombre.`); return; }
    let digito: number | null = null;
    if (td === '31') {
      const calculado = calcularDV(num);
      if (dv && Number(dv) !== calculado) { errores.push(`Fila ${n}: el dígito de verificación del NIT ${num} es ${calculado}, no ${dv}.`); return; }
      digito = calculado;
    }
    const listaTipos = [...new Set(tipos.split(/[,|/ ]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
    const invalidos = listaTipos.filter((t) => !(TIPOS_TERCERO as readonly string[]).includes(t));
    if (invalidos.length) { errores.push(`Fila ${n}: tipo de tercero "${invalidos.join(', ')}" no válido (cliente, proveedor, empleado, otro).`); return; }
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { errores.push(`Fila ${n}: correo inválido "${correo}".`); return; }
    const clave = `${td}:${num}`;
    if (vistos.has(clave)) { errores.push(`Fila ${n}: el documento ${num} está repetido en el archivo.`); return; }
    const tercero: DatosTercero = {
      tipo_doc: td, numero: num, dv: digito, nombre, tipos: listaTipos as DatosTercero['tipos'],
      correo: correo || null, municipio: municipio || null, direccion: direccion || null,
    };
    // Los mismos límites que valida el servidor (largo del nombre, dirección...), para no fallar a mitad de la importación.
    const r = terceroSync.safeParse({ ...tercero, id: '00000000-0000-4000-8000-000000000000' });
    if (!r.success) { errores.push(`Fila ${n}: ${r.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}.`); return; }
    vistos.add(clave);
    terceros.push(tercero);
  });
  return { terceros, errores };
}

/** Crea los terceros leídos; los que ya existen (mismo documento) se omiten y se informan. */
export async function importarTerceros(base: BaseLocal, empresa: string, terceros: readonly DatosTercero[]): Promise<{ creados: number; omitidos: string[] }> {
  let creados = 0;
  const omitidos: string[] = [];
  for (const t of terceros) {
    try {
      await crearTercero(base, empresa, t);
      creados++;
    } catch (e) {
      if (e instanceof ErrorLocal && e.codigo === 'TERCERO_DUPLICADO') omitidos.push(`${t.nombre} (${t.numero}): ya existía.`);
      else throw e;
    }
  }
  return { creados, omitidos };
}
