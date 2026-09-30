import { DatabaseSync } from 'node:sqlite';
import type { PGlite } from '@electric-sql/pglite';
import { como, type Sesion } from '@contafi/supabase/test/entorno';
import { consultaCambios, loteEnvio, obtenerCambios, procesarEnvio } from '@contafi/sync';
import { repositorioPglite } from '../../sync/test/repositorio-pglite.ts';
import type { BaseLocal, Sentencia, ValorSql } from '../src/index.ts';
import { ErrorTransporte, type Transporte } from '../src/index.ts';

/**
 * Base local sobre node:sqlite con la misma configuración que usará Rust en la app:
 * WAL + synchronous=FULL + foreign_keys, y cada lote dentro de BEGIN IMMEDIATE … COMMIT.
 * `fallarEnSentencia` simula un apagón en medio de un lote.
 */
export function baseNode(ruta = ':memory:'): BaseLocal & { db: DatabaseSync; fallarEnSentencia: number | null } {
  const db = new DatabaseSync(ruta);
  db.exec('pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on;');
  const base = {
    db,
    fallarEnSentencia: null as number | null,
    async consultar<T>(sql: string, params: ValorSql[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async lote(sentencias: Sentencia[]): Promise<void> {
      db.exec('begin immediate');
      try {
        sentencias.forEach((x, i) => {
          if (base.fallarEnSentencia === i) {
            base.fallarEnSentencia = null;
            throw new Error('APAGÓN SIMULADO');
          }
          db.prepare(x.sql).run(...(x.params ?? []));
        });
        db.exec('commit');
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
  return base;
}

/**
 * Transporte directo al servicio de sincronización sobre PGlite, pasando por JSON como en HTTP
 * (si algo intentara enviar un bigint, JSON.stringify fallaría aquí igual que en producción).
 */
export function transporteDirecto(db: PGlite, sesion: Sesion) {
  const estado = { enLinea: true, perderSiguienteRespuesta: false };
  const repo = repositorioPglite(db, sesion);
  const viaJson = <T>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  const transporte: Transporte = {
    async enviar(lote) {
      if (!estado.enLinea) throw new ErrorTransporte(0, 'SIN_CONEXION', 'No hay conexión con el servidor.');
      const r = await procesarEnvio(repo, loteEnvio.parse(viaJson(lote)));
      if (estado.perderSiguienteRespuesta) {
        estado.perderSiguienteRespuesta = false;
        throw new ErrorTransporte(0, 'SIN_CONEXION', 'Se cortó la conexión antes de recibir la respuesta.');
      }
      return viaJson(r);
    },
    async cambios(q) {
      if (!estado.enLinea) throw new ErrorTransporte(0, 'SIN_CONEXION', 'No hay conexión con el servidor.');
      return viaJson(await obtenerCambios(repo, consultaCambios.parse(viaJson(q))));
    },
  };
  return { transporte, estado };
}

export const enServidor = async <T>(db: PGlite, s: Sesion, sql: string, p: unknown[] = []) => como<T>(db, s, sql, p);
