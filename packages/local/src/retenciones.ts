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

export async function guardarUvt(base: BaseLocal, anio: number, valorPesos: string): Promise<void> {
  const uvt = aCentavos(valorPesos.replace(/\./g, '').replace(',', '.'));
  if (uvt <= 0n) throw new ErrorLocal('DATOS_INVALIDOS', 'La UVT debe ser mayor que cero.');
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

/** Crea o actualiza un concepto. Valida la tarifa, la base en UVT y que la cuenta sea auxiliar y coherente. */
export async function guardarConcepto(base: BaseLocal, empresa: string, d: DatosConcepto): Promise<void> {
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
  await base.lote([s(
    `insert into conceptos_retencion (empresa_id, codigo, tipo, nombre, tarifa_ppm, base_minima_uvt, cuenta, aplica_en, activo)
     values (?, ?, ?, ?, ?, ?, ?, ?, 1)
     on conflict (empresa_id, codigo) do update set tipo = excluded.tipo, nombre = excluded.nombre, tarifa_ppm = excluded.tarifa_ppm,
       base_minima_uvt = excluded.base_minima_uvt, cuenta = excluded.cuenta, aplica_en = excluded.aplica_en, activo = 1`,
    empresa, codigo, d.tipo, d.nombre.trim(), tarifa, base_, d.cuenta, d.aplicaEn)]);
}

export async function desactivarConcepto(base: BaseLocal, empresa: string, codigo: string): Promise<void> {
  await base.lote([s('update conceptos_retencion set activo = 0 where empresa_id = ? and codigo = ?', empresa, codigo)]);
}

export async function retencionesDeProveedor(base: BaseLocal, empresa: string, nit: string): Promise<string[]> {
  return (await base.consultar<{ codigo: string }>('select codigo from retenciones_proveedor where empresa_id = ? and nit = ? order by codigo',
    [empresa, limpiarNit(nit)])).map((f) => f.codigo);
}

export function sentenciasRetencionesProveedor(empresa: string, nit: string, codigos: readonly string[]) {
  const n = limpiarNit(nit);
  return [
    s('delete from retenciones_proveedor where empresa_id = ? and nit = ?', empresa, n),
    ...codigos.map((c) => s('insert into retenciones_proveedor (empresa_id, nit, codigo) values (?, ?, ?)', empresa, n, c)),
  ];
}
