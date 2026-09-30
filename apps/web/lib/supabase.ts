import 'server-only';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { entorno } from './entorno.ts';
import { ErrorHttp } from './http.ts';

/**
 * Cliente de Supabase que actúa COMO EL USUARIO: usa la llave pública (anon) y el token de su sesión.
 * PostgREST valida el token en cada consulta y RLS decide qué puede ver y hacer.
 */
export function clienteDelUsuario(token: string): SupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = entorno();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Convierte los errores de PostgREST/Postgres en respuestas HTTP con sentido para la app. */
export function traducirError(e: PostgrestError): ErrorHttp {
  const mensaje = e.message ?? '';
  if (e.code?.startsWith('PGRST30')) return new ErrorHttp(401, 'SESION_INVALIDA', 'La sesión venció o no es válida. Inicie sesión de nuevo.');
  const codigo = /^([A-Z_]{4,})(:|$)/.exec(mensaje)?.[1];
  if (e.code === '42501') return new ErrorHttp(403, codigo ?? 'SIN_PERMISO', mensaje);
  if (e.code === '22023' || e.code === 'P0001') return new ErrorHttp(422, codigo ?? 'DATOS_INVALIDOS', mensaje);
  return new ErrorHttp(502, 'ERROR_BASE_DE_DATOS', 'La base de datos no respondió como se esperaba.');
}
