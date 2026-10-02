import type { Centavos, FechaISO } from '@contafi/shared';
import { EN_LIBROS, type Comprobante, type Cuenta } from './tipos.ts';

/**
 * Doble corrida del piloto (Fase 6, sección 13: "cero diferencias"): compara el balance de Contafi a una
 * fecha de corte con el balance del software anterior. Cada fila del otro software se compara con la suma
 * de las cuentas de Contafi que empiezan por su código, así sirve a cualquier nivel del PUC (si el otro
 * software trae "1105", se compara con 110505 + 110510 + …).
 */
export interface FilaExterna {
  cuenta: string;
  nombre?: string;
  /** Saldo como débito − crédito (positivo = saldo débito). */
  saldo: Centavos;
}

export interface FilaComparada {
  cuenta: string;
  nombre: string;
  externo: Centavos;
  contafi: Centavos;
  diferencia: Centavos;
}

export interface ResultadoComparacion {
  filas: FilaComparada[];
  /** Solo las filas con diferencia. */
  diferencias: FilaComparada[];
  /** Cuentas de Contafi con saldo que el otro software no tiene en ningún nivel. */
  soloContafi: { cuenta: string; nombre: string; saldo: Centavos }[];
  /** true = cero diferencias (el criterio de salida del piloto). */
  sinDiferencias: boolean;
}

/** Saldo (débito − crédito) de cada cuenta auxiliar con lo que está en libros hasta el corte. */
export function saldosAlCorte(comprobantes: readonly Comprobante[], corte: FechaISO): Map<string, Centavos> {
  const saldos = new Map<string, Centavos>();
  for (const c of comprobantes) {
    if (!EN_LIBROS.has(c.estado) || c.fecha > corte) continue;
    for (const l of c.lineas) saldos.set(l.cuenta, (saldos.get(l.cuenta) ?? 0n) + l.debito - l.credito);
  }
  return saldos;
}

export function compararBalance(
  cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], corte: FechaISO, externas: readonly FilaExterna[],
): ResultadoComparacion {
  const nombres = new Map([...cuentas].map((c) => [c.codigo, c.nombre]));
  const saldos = saldosAlCorte(comprobantes, corte);
  // Si el archivo repite una cuenta (p. ej. por tercero), se suman sus saldos.
  const porCuenta = new Map<string, { nombre?: string; saldo: Centavos }>();
  for (const f of externas) {
    const a = porCuenta.get(f.cuenta);
    porCuenta.set(f.cuenta, { nombre: a?.nombre ?? f.nombre, saldo: (a?.saldo ?? 0n) + f.saldo });
  }
  const filas = [...porCuenta].sort(([a], [b]) => a.localeCompare(b)).map(([cuenta, f]): FilaComparada => {
    let contafi = 0n;
    for (const [codigo, saldo] of saldos) if (codigo.startsWith(cuenta)) contafi += saldo;
    return { cuenta, nombre: nombres.get(cuenta) ?? f.nombre ?? '', externo: f.saldo, contafi, diferencia: contafi - f.saldo };
  });
  const codigos = [...porCuenta.keys()];
  const soloContafi = [...saldos]
    .filter(([codigo, saldo]) => saldo !== 0n && !codigos.some((c) => codigo.startsWith(c)))
    .map(([cuenta, saldo]) => ({ cuenta, nombre: nombres.get(cuenta) ?? '', saldo }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
  const diferencias = filas.filter((f) => f.diferencia !== 0n);
  return { filas, diferencias, soloContafi, sinDiferencias: diferencias.length === 0 && soloContafi.length === 0 };
}
