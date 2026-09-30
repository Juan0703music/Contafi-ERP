/**
 * Base de datos de prueba: Postgres real en proceso (PGlite) que imita lo que Supabase trae de fábrica:
 * roles anon/authenticated, esquema auth con auth.uid() y auth.jwt(), y los PRIVILEGIOS POR DEFECTO
 * de Supabase (todo objeto nuevo de public queda con permisos para anon y authenticated). Así las
 * pruebas detectan funciones o tablas que quedaron expuestas por olvidar un revoke.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const IMITACION_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

export async function crearBaseDePrueba(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(IMITACION_SUPABASE);
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  return db;
}

export interface Sesion {
  /** Id del usuario (auth.users.id). null = sin sesión (rol anon). */
  sub: string | null;
  email?: string;
  /** aal2 = MFA verificado en esta sesión. */
  aal?: 'aal1' | 'aal2';
}

/** Ejecuta SQL como lo haría PostgREST con el JWT de la sesión (RLS y privilegios aplican). */
export async function como<T = Record<string, unknown>>(db: PGlite, sesion: Sesion, sql: string, params: unknown[] = []): Promise<T[]> {
  const claims = sesion.sub ? { sub: sesion.sub, email: sesion.email, aal: sesion.aal ?? 'aal1', role: 'authenticated' } : { role: 'anon' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${sesion.sub ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

/** Crea un usuario como lo haría Supabase Auth al registrarse (dispara el trigger de perfil). */
export async function registrarUsuario(db: PGlite, id: string, email: string, nombre?: string): Promise<void> {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [id, email, JSON.stringify(nombre ? { nombre } : {})]);
}
