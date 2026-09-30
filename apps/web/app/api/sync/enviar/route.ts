import { loteEnvio, procesarEnvio } from '@contafi/sync';
import { leerJson, ok, responderError, tokenDe } from '@/lib/http.ts';
import { clienteDelUsuario } from '@/lib/supabase.ts';
import { repositorioSupabase } from '@/lib/repositorio-supabase.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/sync/enviar — la app envía su cola de salida (sección 9.2).
 * Cuerpo: LoteEnvio (ver @contafi/sync/protocolo). Respuesta: un resultado por comprobante.
 */
export async function POST(req: Request) {
  try {
    const token = tokenDe(req);
    const lote = loteEnvio.parse(await leerJson(req));
    return ok(await procesarEnvio(repositorioSupabase(clienteDelUsuario(token)), lote));
  } catch (e) {
    return responderError(e);
  }
}
