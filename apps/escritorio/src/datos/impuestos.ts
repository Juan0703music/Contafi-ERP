import type { SupabaseClient } from '@supabase/supabase-js';
import { aDecimal } from '@contafi/shared';
import type { FilaCalendario } from '@contafi/motor';
import {
  conceptosRetencion, desactivarConcepto, guardarCalendario, guardarConcepto, guardarObligaciones, guardarUvt, leerUvt, validarConcepto,
  type BaseLocal, type DatosConcepto,
} from '@contafi/local';
import { mensajeServidor } from './firma.ts';

/**
 * Configuración tributaria (D-024). En la nube se guarda en el servidor —requiere conexión, como cerrar un
 * período— y llega a todos los PC al sincronizar. En la demostración se guarda en este equipo.
 */
export interface ConfiguracionImpuestos {
  compartida: boolean;
  guardarUvt(empresa: string, anio: number, valor: string): Promise<void>;
  guardarConcepto(empresa: string, d: DatosConcepto): Promise<void>;
  desactivarConcepto(empresa: string, codigo: string): Promise<void>;
  /** Calendario tributario del año (para toda la firma). */
  guardarCalendario(empresa: string, anio: number, filas: readonly FilaCalendario[]): Promise<void>;
  /** Obligaciones de la empresa (códigos del calendario). */
  guardarObligaciones(empresa: string, codigos: readonly string[]): Promise<void>;
}

export function impuestosLocales(base: BaseLocal): ConfiguracionImpuestos {
  return {
    compartida: false,
    guardarUvt: (_e, anio, valor) => guardarUvt(base, anio, valor),
    guardarConcepto: (empresa, d) => guardarConcepto(base, empresa, d),
    desactivarConcepto: (empresa, codigo) => desactivarConcepto(base, empresa, codigo),
    guardarCalendario: (_e, anio, filas) => guardarCalendario(base, anio, filas),
    guardarObligaciones: (empresa, codigos) => guardarObligaciones(base, empresa, codigos),
  };
}

export function impuestosNube(sb: SupabaseClient, base: BaseLocal): ConfiguracionImpuestos {
  async function rpc(fn: string, args: Record<string, unknown>) {
    const { error } = await sb.rpc(fn, args);
    if (error) throw new Error(mensajeServidor(error));
  }
  return {
    compartida: true,
    // Se valida aquí con las mismas reglas que el servidor, para avisar sin ir a la red.
    guardarUvt: (empresa, anio, valor) => rpc('guardar_uvt', { p_empresa: empresa, p_anio: anio, p_uvt: aDecimal(leerUvt(valor)) }),
    async guardarConcepto(empresa, d) {
      const c = await validarConcepto(base, empresa, d);
      await rpc('guardar_concepto_retencion', { p: { ...c, empresa_id: empresa, activo: true } });
    },
    async desactivarConcepto(empresa, codigo) {
      const c = (await conceptosRetencion(base, empresa)).find((x) => x.codigo === codigo);
      if (!c) throw new Error(`El concepto ${codigo} no existe.`);
      await rpc('guardar_concepto_retencion', { p: {
        empresa_id: empresa, codigo, tipo: c.tipo, nombre: c.nombre, tarifa_ppm: Number(c.tarifa), base_minima_uvt: c.baseMinimaUvt,
        cuenta: c.cuenta, aplica_en: c.aplicaEn, activo: false,
      } });
    },
    guardarCalendario: (empresa, anio, filas) => rpc('guardar_calendario', { p_empresa: empresa, p_anio: anio, p_filas: filas }),
    guardarObligaciones: (empresa, codigos) => rpc('guardar_obligaciones', { p_empresa: empresa, p_codigos: [...codigos] }),
  };
}
