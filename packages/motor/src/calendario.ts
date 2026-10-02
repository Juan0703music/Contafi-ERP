import { diasEntre, limpiarNit, type FechaISO } from '@contafi/shared';

/**
 * Calendario tributario (panel del contador: "vencimientos"). Las fechas NO están en el código: las carga
 * el contador cada año desde el decreto del calendario (regla de oro, sección 5.5). Cada fila dice qué
 * obligación vence, de qué período y para qué último dígito del NIT (null = para todos).
 */
export interface FilaCalendario {
  obligacion: string;
  nombre: string;
  periodo: string;
  /** Último dígito del NIT (sin DV) al que aplica; null = a todos. */
  digito: string | null;
  fecha: FechaISO;
}

export interface Vencimiento extends FilaCalendario {
  /** Días que faltan (0 = hoy; negativo = ya pasó). */
  dias: number;
}

/** Vencimientos de una empresa entre `desde` y `desde + dias`, según sus obligaciones y su NIT. */
export function vencimientosEmpresa(
  empresa: { nit: string; obligaciones: readonly string[] },
  calendario: readonly FilaCalendario[],
  desde: FechaISO,
  dias = 45,
): Vencimiento[] {
  const nit = limpiarNit(empresa.nit);
  const digito = nit.slice(-1);
  const propias = new Set(empresa.obligaciones);
  return calendario
    .filter((f) => propias.has(f.obligacion) && (f.digito === null || f.digito === digito))
    .map((f) => ({ ...f, dias: diasEntre(desde, f.fecha) }))
    .filter((v) => v.dias >= 0 && v.dias <= dias)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.obligacion.localeCompare(b.obligacion));
}
