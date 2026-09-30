import { consultaCambios, obtenerCambios } from '@contafi/sync';
import { ok, responderError, tokenDe } from '@/lib/http.ts';
import { clienteDelUsuario } from '@/lib/supabase.ts';
import { repositorioSupabase } from '@/lib/repositorio-supabase.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sync/cambios?empresa_id=...&desde=0&limite=500 — recepción incremental (sección 9.3).
 * La app guarda `ultima_seq` y repite mientras `hay_mas` sea true.
 */
export async function GET(req: Request) {
  try {
    const token = tokenDe(req);
    const url = new URL(req.url);
    const q = consultaCambios.parse(Object.fromEntries(url.searchParams));
    return ok(await obtenerCambios(repositorioSupabase(clienteDelUsuario(token)), q));
  } catch (e) {
    return responderError(e);
  }
}
