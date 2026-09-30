/**
 * Contrato mínimo con la base local. En la app lo implementa Rust (rusqlite + SQLCipher) mediante
 * comandos de Tauri; en las pruebas, node:sqlite. Toda escritura va en un LOTE atómico: o se aplican
 * todas las sentencias o ninguna (sección 9.5: lo confirmado sobrevive a un apagón, lo demás no existe).
 *
 * Regla: los montos NUNCA viajan como number. Se guardan como INTEGER en centavos, se leen con
 * CAST(x AS TEXT) y se envían como texto (ver `param`).
 */
export type ValorSql = string | number | null;

export interface Sentencia {
  sql: string;
  params?: ValorSql[];
}

export interface BaseLocal {
  consultar<T = Record<string, unknown>>(sql: string, params?: ValorSql[]): Promise<T[]>;
  lote(sentencias: Sentencia[]): Promise<void>;
}

/** Convierte un valor de TypeScript a parámetro SQL sin perder precisión. */
export function param(v: bigint | string | number | boolean | null | undefined): ValorSql {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new TypeError(`Número no seguro para SQL: ${v}`);
  return v;
}

export const s = (sql: string, ...params: Parameters<typeof param>[0][]): Sentencia => ({ sql, params: params.map(param) });
