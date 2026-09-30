import { hoyBogota, type Centavos, type FechaISO } from '@contafi/shared';
import type { BaseLocal } from './base.ts';
import { estadoSincronizacion, type EstadoSincronizacion } from './contabilidad.ts';
import { resumenPeriodos, utilidadDelAnio } from './cierres.ts';

export interface ResumenEmpresa {
  empresaId: string;
  sync: EstadoSincronizacion;
  /** Meses ya terminados del año que siguen abiertos y tienen movimiento. */
  mesesSinCerrar: number[];
  utilidadAnio: Centavos;
  comprobantesAnio: number;
  alertas: string[];
}

/** Panel del contador (sección 11.1): el estado de cada empresa en una sola vista. */
export async function resumenEmpresa(base: BaseLocal, empresa: string, hoy: FechaISO = hoyBogota(), momento = new Date()): Promise<ResumenEmpresa> {
  const anio = Number(hoy.slice(0, 4));
  const mesActual = Number(hoy.slice(5, 7));
  const [sync, periodos, utilidadAnio] = await Promise.all([
    estadoSincronizacion(base, empresa, momento), resumenPeriodos(base, empresa, anio), utilidadDelAnio(base, empresa, anio),
  ]);
  const mesesSinCerrar = periodos.filter((p) => p.mes < mesActual && p.estado === 'abierto' && p.comprobantes > 0).map((p) => p.mes);
  const alertas: string[] = [];
  if (sync.alerta) alertas.push(sync.diasSinSincronizar === null ? 'Nunca se ha sincronizado' : `${sync.diasSinSincronizar} días sin sincronizar`);
  if (sync.rechazados + sync.tercerosConError) alertas.push(`${sync.rechazados + sync.tercerosConError} registro(s) rechazados`);
  if (sync.porAprobar) alertas.push(`${sync.porAprobar} comprobante(s) por aprobar`);
  if (mesesSinCerrar.length >= 2) alertas.push(`${mesesSinCerrar.length} meses sin cerrar`);
  return {
    empresaId: empresa, sync, mesesSinCerrar, utilidadAnio,
    comprobantesAnio: periodos.reduce((s, p) => s + p.comprobantes, 0),
    alertas,
  };
}
