import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { BaseLocal } from '@contafi/local';

/**
 * Base local en el navegador (SQLite compilado a WebAssembly, en memoria).
 * Solo para el modo demostración y el desarrollo: en la app de escritorio la base es SQLCipher en disco.
 */
export async function abrirBaseNavegador(): Promise<BaseLocal> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec('pragma foreign_keys = on');
  return {
    async consultar<T>(sql: string, params: (string | number | null)[] = []) {
      return db.selectObjects(sql, params.length ? params : undefined) as T[];
    },
    async lote(sentencias) {
      db.transaction((d) => {
        for (const s of sentencias) {
          if (s.params?.length) d.exec({ sql: s.sql, bind: s.params });
          else d.exec(s.sql);
        }
      });
    },
  };
}
