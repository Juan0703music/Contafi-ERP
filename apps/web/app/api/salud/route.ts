import { VERSION_PROTOCOLO } from '@contafi/sync';
import { ok } from '@/lib/http.ts';

export const dynamic = 'force-dynamic';

/** GET /api/salud — para el monitor de disponibilidad y para que la app sepa si hay conexión. */
export function GET() {
  return ok({ estado: 'ok', version_protocolo: VERSION_PROTOCOLO, hora: new Date().toISOString() });
}
