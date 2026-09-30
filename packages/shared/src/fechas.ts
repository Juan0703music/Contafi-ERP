/**
 * Fechas contables en la zona America/Bogota.
 *
 * Corrige el error del prototipo: todayISO() usaba toISOString() (UTC), y después de las
 * 7:00 p. m. en Colombia registraba la fecha del día siguiente.
 */
export type FechaISO = string; // "AAAA-MM-DD"
export type Periodo = string; // "AAAA-MM"

export const ZONA_COLOMBIA = 'America/Bogota';

const formateador = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_COLOMBIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha calendario en Colombia para un instante dado (por defecto, ahora). */
export function hoyBogota(instante: Date = new Date()): FechaISO {
  return formateador.format(instante); // en-CA produce AAAA-MM-DD
}

export function esFechaValida(f: string): f is FechaISO {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const [a, m, d] = f.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function periodoDe(fecha: FechaISO): Periodo {
  if (!esFechaValida(fecha)) throw new RangeError(`Fecha inválida: "${fecha}"`);
  return fecha.slice(0, 7);
}

export function anioDe(fecha: FechaISO): number {
  return Number(fecha.slice(0, 4));
}

/** Días entre dos fechas calendario (b − a). */
export function diasEntre(a: FechaISO, b: FechaISO): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function sumarDias(f: FechaISO, dias: number): FechaISO {
  const d = new Date(Date.parse(`${f}T00:00:00Z`) + dias * 86_400_000);
  return d.toISOString().slice(0, 10); // seguro: la fecha base está en UTC a medianoche
}
