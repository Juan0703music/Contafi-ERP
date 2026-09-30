import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { transporteHttp, type EmpresaLocal, type Transporte } from '@contafi/local';

/** Conexión con Supabase y la API. Sin variables de entorno, la app corre en modo demostración. */
export function configuracionNube(): { supabase: SupabaseClient; api: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const api = import.meta.env.VITE_API_URL as string | undefined;
  if (!url || !clave || !api) return null;
  return { supabase: createClient(url, clave, { auth: { persistSession: true, autoRefreshToken: true } }), api };
}

export function transporteNube(supabase: SupabaseClient, api: string): Transporte {
  const token = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('No hay sesión activa.');
    return data.session.access_token;
  };
  return transporteHttp({
    urlBase: api,
    token,
    renovarToken: async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) throw new Error('La sesión venció. Inicie sesión de nuevo.');
      return data.session.access_token;
    },
  });
}

export async function empresasDelUsuario(supabase: SupabaseClient): Promise<EmpresaLocal[]> {
  const { data, error } = await supabase.from('empresas').select('id, firma_id, nit, dv, razon_social').eq('activa', true).order('razon_social');
  if (error) throw new Error(error.message);
  return data as EmpresaLocal[];
}

/** Identificador estable de este PC (se combina en el servidor con el usuario: un PC puede ser compartido). */
export function dispositivoLocal(version: string): { id: string; nombre: string; version_app: string } {
  const clave = 'contafi:dispositivo';
  let id: string | null = null;
  try { id = localStorage.getItem(clave); } catch { /* almacenamiento no disponible */ }
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem(clave, id); } catch { /* se usará un id nuevo en cada inicio */ }
  }
  return { id, nombre: navigator.platform || 'PC', version_app: version };
}
