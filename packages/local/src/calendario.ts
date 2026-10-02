import { esFechaValida, hoyBogota, type FechaISO } from '@contafi/shared';
import { vencimientosEmpresa, type FilaCalendario, type Vencimiento } from '@contafi/motor';
import { s, type BaseLocal, type Sentencia } from './base.ts';
import { ErrorLocal } from './contabilidad.ts';

/**
 * Calendario tributario (panel del contador: vencimientos). Contafi no trae fechas: el contador copia las
 * del decreto del calendario del año en la plantilla. Las filas de la plantilla son solo un ejemplo.
 */
export const PLANTILLA_CALENDARIO = [
  'obligacion;nombre;periodo;ultimo_digito_nit;fecha',
  'RETENCION;Retención en la fuente (EJEMPLO: reemplace las fechas con las del decreto);2026-01;1;10/02/2026',
  'RETENCION;Retención en la fuente (EJEMPLO);2026-01;2;11/02/2026',
  'IVA_BIM;IVA bimestral (EJEMPLO);2026-B1;1;10/03/2026',
  'EXOGENA;Información exógena (EJEMPLO, sin dígito = aplica a todos);2025;;05/05/2026',
].join('\r\n');

export interface LecturaCalendario {
  filas: FilaCalendario[];
  errores: string[];
}

/** Lee el CSV del calendario con las mismas reglas que el servidor (guardar_calendario). */
export function leerCalendarioCsv(texto: string, anio: number): LecturaCalendario {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const sep = (lineas[0] ?? '').includes(';') ? ';' : ',';
  const filas: FilaCalendario[] = [];
  const errores: string[] = [];
  lineas.forEach((linea, i) => {
    const n = i + 1;
    const [obl = '', nombre = '', periodo = '', digito = '', fechaTxt = ''] = linea.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /obligaci/i.test(obl)) return;
    const obligacion = obl.toUpperCase().replace(/\s+/g, '_');
    if (!/^[A-Z0-9_-]{2,30}$/.test(obligacion)) { errores.push(`Fila ${n}: código de obligación inválido "${obl}" (letras, números, _ o -).`); return; }
    if (!nombre || nombre.length > 120) { errores.push(`Fila ${n}: falta el nombre de la obligación.`); return; }
    if (!periodo || periodo.length > 20) { errores.push(`Fila ${n}: falta el período (p. ej. 2026-01 o 2026-B1).`); return; }
    if (digito && !/^\d$/.test(digito)) { errores.push(`Fila ${n}: el último dígito del NIT debe ser de 0 a 9 (o vacío si aplica a todos).`); return; }
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(fechaTxt);
    const fecha = m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : fechaTxt;
    if (!esFechaValida(fecha)) { errores.push(`Fila ${n}: fecha inválida "${fechaTxt}" (dd/mm/aaaa).`); return; }
    const a = Number(fecha.slice(0, 4));
    if (a < anio - 1 || a > anio + 1) { errores.push(`Fila ${n}: la fecha ${fechaTxt} no corresponde al calendario de ${anio}.`); return; }
    filas.push({ obligacion, nombre, periodo, digito: digito || null, fecha: fecha as FechaISO });
  });
  if (!filas.length && !errores.length) errores.push('El archivo no tiene filas.');
  return { filas, errores };
}

export const sentenciaCalendario = (anio: number, filas: readonly FilaCalendario[]): Sentencia =>
  s('insert into calendario (anio, filas) values (?, ?) on conflict (anio) do update set filas = excluded.filas', anio, JSON.stringify(filas));

export const sentenciaObligaciones = (empresa: string, codigos: readonly string[]): Sentencia =>
  s('insert into obligaciones (empresa_id, codigos) values (?, ?) on conflict (empresa_id) do update set codigos = excluded.codigos',
    empresa, JSON.stringify([...new Set(codigos)].sort()));

/** En este PC (modo demostración; en la nube lo guarda el servidor y llega al sincronizar). */
export async function guardarCalendario(base: BaseLocal, anio: number, filas: readonly FilaCalendario[]): Promise<void> {
  if (!filas.length) throw new ErrorLocal('DATOS_INVALIDOS', 'El calendario no tiene filas.');
  await base.lote([sentenciaCalendario(anio, filas)]);
}

export async function guardarObligaciones(base: BaseLocal, empresa: string, codigos: readonly string[]): Promise<void> {
  await base.lote([sentenciaObligaciones(empresa, codigos)]);
}

export async function calendariosCargados(base: BaseLocal): Promise<{ anio: number; filas: FilaCalendario[] }[]> {
  const r = await base.consultar<{ anio: number; filas: string }>('select anio, filas from calendario order by anio desc');
  return r.map((x) => ({ anio: Number(x.anio), filas: JSON.parse(x.filas) as FilaCalendario[] }));
}

export async function obligacionesEmpresa(base: BaseLocal, empresa: string): Promise<string[]> {
  const [f] = await base.consultar<{ codigos: string }>('select codigos from obligaciones where empresa_id = ?', [empresa]);
  return f ? (JSON.parse(f.codigos) as string[]) : [];
}

/** Obligaciones que aparecen en los calendarios cargados (para marcarlas en cada empresa). */
export async function catalogoObligaciones(base: BaseLocal): Promise<{ codigo: string; nombre: string }[]> {
  const vistas = new Map<string, string>();
  for (const c of await calendariosCargados(base)) for (const f of c.filas) if (!vistas.has(f.obligacion)) vistas.set(f.obligacion, f.nombre);
  return [...vistas].map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function vencimientosLocales(base: BaseLocal, empresa: string, desde: FechaISO = hoyBogota(), dias = 45): Promise<Vencimiento[]> {
  const [e] = await base.consultar<{ nit: string }>('select nit from empresas where id = ?', [empresa]);
  if (!e) return [];
  const filas = (await calendariosCargados(base)).flatMap((c) => c.filas);
  return vencimientosEmpresa({ nit: e.nit, obligaciones: await obligacionesEmpresa(base, empresa) }, filas, desde, dias);
}
