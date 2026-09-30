import { invoke } from '@tauri-apps/api/core';
import type { BaseLocal, Sentencia, ValorSql } from '@contafi/local';

export interface EstadoApertura {
  /** nueva: primera vez · ok: íntegra · restaurada: estaba dañada y se recuperó del último respaldo. */
  estado: 'nueva' | 'ok' | 'restaurada';
  ruta: string;
  respaldo: string | null;
  mensaje: string | null;
}

export const enTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Base local de la app de escritorio: SQLCipher en disco, manejada por Rust (src-tauri/src/base.rs).
 * Al abrir, Rust verifica la integridad, restaura el último respaldo si hace falta y hace el respaldo diario.
 */
export async function abrirBaseTauri(): Promise<{ base: BaseLocal; apertura: EstadoApertura }> {
  const apertura = await invoke<EstadoApertura>('abrir_base');
  const base: BaseLocal = {
    consultar: <T>(sql: string, params: ValorSql[] = []) => invoke<T[]>('sql_consultar', { sql, params }),
    lote: (sentencias: Sentencia[]) => invoke<void>('sql_lote', { sentencias }),
  };
  return { base, apertura };
}

/** Cierra la base al cerrar sesión: la llave deja de estar en memoria (sección 10). */
export async function cerrarBaseTauri(): Promise<void> {
  if (enTauri()) await invoke('cerrar_base');
}
