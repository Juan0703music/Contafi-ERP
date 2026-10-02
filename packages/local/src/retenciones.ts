import { aCentavos, leerTarifaUsuario, limpiarNit, type Centavos } from '@contafi/shared';
import type { ConceptoRetencion, ParametrosAnuales } from '@contafi/motor';
import { s, type BaseLocal } from './base.ts';
import { ErrorLocal, cuentasLocales } from './contabilidad.ts';

/**
 * Parámetros tributarios configurables (sección 5.5, regla de oro). Contafi NO trae tarifas ni UVT
 * escritas en el código: las configura el contador por empresa y por año, con la norma vigente.
 */
export interface ConceptoConfigurado extends ConceptoRetencion {
  aplicaEn: 'compras' | 'ventas';
  activo: boolean;
}

/** UVT escrita por el usuario ("52.374" o "52374,50") en centavos. */
export function leerUvt(valorPesos: string): Centavos {
  let uvt: Centavos;
  try { uvt = aCentavos(valorPesos.trim().replace(/\./g, '').replace(',', '.')); } catch { uvt = 0n; }
  if (uvt <= 0n) throw new ErrorLocal('DATOS_INVALIDOS', 'La UVT debe ser un valor en pesos mayor que cero, p. ej. 49.799.');
  return uvt;
}

export async function guardarUvt(base: BaseLocal, anio: number, valorPesos: string): Promise<void> {
  const uvt = leerUvt(valorPesos);
  await base.lote([s('insert into parametros_anuales (anio, uvt) values (?, ?) on conflict (anio) do update set uvt = excluded.uvt', anio, uvt)]);
}

export async function uvtsConfiguradas(base: BaseLocal): Promise<{ anio: number; uvt: Centavos }[]> {
  const filas = await base.consultar<{ anio: number; uvt: string }>('select anio, cast(uvt as text) as uvt from parametros_anuales order by anio desc');
  return filas.map((f) => ({ anio: Number(f.anio), uvt: BigInt(f.uvt) }));
}

export async function parametrosDelAnio(base: BaseLocal, anio: number): Promise<ParametrosAnuales | null> {
  const [f] = await base.consultar<{ uvt: string }>('select cast(uvt as text) as uvt from parametros_anuales where anio = ?', [anio]);
  return f ? { anio, uvt: BigInt(f.uvt) } : null;
}

export async function conceptosRetencion(base: BaseLocal, empresa: string, soloActivos = false): Promise<ConceptoConfigurado[]> {
  const filas = await base.consultar<Record<string, string | number>>(
    `select codigo, tipo, nombre, cast(tarifa_ppm as text) as tarifa, base_minima_uvt, cuenta, aplica_en, activo
       from conceptos_retencion where empresa_id = ? ${soloActivos ? 'and activo = 1' : ''} order by aplica_en, tipo, codigo`, [empresa]);
  return filas.map((f) => ({
    codigo: String(f['codigo']), tipo: f['tipo'] as ConceptoRetencion['tipo'], nombre: String(f['nombre']),
    tarifa: BigInt(String(f['tarifa'])), baseMinimaUvt: String(f['base_minima_uvt']), cuenta: String(f['cuenta']),
    aplicaEn: f['aplica_en'] as 'compras' | 'ventas', activo: !!f['activo'],
  }));
}

export interface DatosConcepto {
  codigo: string;
  tipo: ConceptoRetencion['tipo'];
  nombre: string;
  /** Porcentaje escrito por el usuario: "2,5", "0,966". */
  tarifa: string;
  baseMinimaUvt: string;
  cuenta: string;
  aplicaEn: 'compras' | 'ventas';
}

/** Concepto validado, como lo guardan la base local y el servidor (guardar_concepto_retencion). */
export interface ConceptoValidado {
  codigo: string;
  tipo: ConceptoRetencion['tipo'];
  nombre: string;
  tarifa_ppm: number;
  base_minima_uvt: string;
  cuenta: string;
  aplica_en: 'compras' | 'ventas';
}

/** Valida la tarifa, la base en UVT y que la cuenta sea auxiliar y coherente (las mismas reglas del servidor). */
export async function validarConcepto(base: BaseLocal, empresa: string, d: DatosConcepto): Promise<ConceptoValidado> {
  const codigo = d.codigo.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) throw new ErrorLocal('DATOS_INVALIDOS', 'El código debe tener de 2 a 20 letras, números o guiones.');
  if (!d.nombre.trim()) throw new ErrorLocal('DATOS_INVALIDOS', 'Escriba un nombre para el concepto.');
  const tarifa = leerTarifaUsuario(d.tarifa);
  if (tarifa === null) throw new ErrorLocal('DATOS_INVALIDOS', `Tarifa inválida: "${d.tarifa}". Escríbala en porcentaje, p. ej. 2,5.`);
  const base_ = d.baseMinimaUvt.trim().replace(',', '.') || '0';
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(base_)) throw new ErrorLocal('DATOS_INVALIDOS', 'La base mínima en UVT debe ser un número, p. ej. 10 o 27.');
  const cuenta = (await cuentasLocales(base, empresa)).find((c) => c.codigo === d.cuenta);
  if (!cuenta?.aceptaMovimiento) throw new ErrorLocal('DATOS_INVALIDOS', `La cuenta ${d.cuenta} no existe o no es auxiliar.`);
  // Practicadas en compras: pasivo por pagar (2365/2367/2368). Recibidas en ventas: anticipo de impuestos (1355).
  if (d.aplicaEn === 'compras' && !cuenta.codigo.startsWith('23')) throw new ErrorLocal('DATOS_INVALIDOS', 'Las retenciones que se practican en compras van en una cuenta por pagar del grupo 23 (2365, 2367, 2368).');
  if (d.aplicaEn === 'ventas' && !cuenta.codigo.startsWith('13')) throw new ErrorLocal('DATOS_INVALIDOS', 'Las retenciones que le practican a la empresa en ventas van en el grupo 13 (1355).');
  return { codigo, tipo: d.tipo, nombre: d.nombre.trim(), tarifa_ppm: Number(tarifa), base_minima_uvt: base_, cuenta: d.cuenta, aplica_en: d.aplicaEn };
}

/** Crea o actualiza un concepto en este PC (modo demostración; en la nube lo guarda el servidor). */
export async function guardarConcepto(base: BaseLocal, empresa: string, d: DatosConcepto): Promise<void> {
  await base.lote([sentenciaConcepto(empresa, await validarConcepto(base, empresa, d), true)]);
}

/** Base mínima en UVT sin ceros de sobra ("10.000" del servidor → "10"; "27.500" → "27.5"). */
export const normalizarBaseUvt = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

export function sentenciaConcepto(empresa: string, c: ConceptoValidado, activo: boolean) {
  return s(
    `insert into conceptos_retencion (empresa_id, codigo, tipo, nombre, tarifa_ppm, base_minima_uvt, cuenta, aplica_en, activo)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (empresa_id, codigo) do update set tipo = excluded.tipo, nombre = excluded.nombre, tarifa_ppm = excluded.tarifa_ppm,
       base_minima_uvt = excluded.base_minima_uvt, cuenta = excluded.cuenta, aplica_en = excluded.aplica_en, activo = excluded.activo`,
    empresa, c.codigo, c.tipo, c.nombre, c.tarifa_ppm, normalizarBaseUvt(c.base_minima_uvt), c.cuenta, c.aplica_en, activo ? 1 : 0);
}

export async function desactivarConcepto(base: BaseLocal, empresa: string, codigo: string): Promise<void> {
  await base.lote([s('update conceptos_retencion set activo = 0 where empresa_id = ? and codigo = ?', empresa, codigo)]);
}

/** Retenciones aprendidas para un proveedor ([] si nunca se aprendieron). */
export async function retencionesDeProveedor(base: BaseLocal, empresa: string, nit: string): Promise<string[]> {
  const [f] = await base.consultar<{ retenciones: string | null }>('select retenciones from reglas_proveedor where empresa_id = ? and nit = ?',
    [empresa, limpiarNit(nit)]);
  return f?.retenciones ? (JSON.parse(f.retenciones) as string[]) : [];
}

/**
 * Lo que la importación aprende de un proveedor (la cuenta, las retenciones o ambas) y su envío al
 * servidor, que lo comparte con los demás PC. Lo que no se pasa (undefined) no cambia.
 */
export function sentenciasAprenderRegla(empresa: string, nit: string, a: { cuenta?: string; retenciones?: readonly string[] }) {
  if (a.cuenta === undefined && a.retenciones === undefined) return [];
  const n = limpiarNit(nit);
  const ahora = new Date().toISOString();
  return [
    s(`insert into reglas_proveedor (empresa_id, nit, cuenta, retenciones, actualizado_en) values (?, ?, ?, ?, ?)
       on conflict (empresa_id, nit) do update set cuenta = coalesce(excluded.cuenta, reglas_proveedor.cuenta),
         retenciones = coalesce(excluded.retenciones, reglas_proveedor.retenciones), actualizado_en = excluded.actualizado_en`,
      empresa, n, a.cuenta ?? null, a.retenciones === undefined ? null : JSON.stringify([...a.retenciones].sort()), ahora),
    s(`insert into cola_salida (empresa_id, tipo, registro_id, creado_en) values (?, 'regla', ?, ?)
       on conflict (empresa_id, tipo, registro_id) do nothing`, empresa, n, ahora),
  ];
}
