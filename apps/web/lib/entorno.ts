import 'server-only';
import { z } from 'zod';

const esquema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  RESEND_API_KEY: z.string().optional(),
  CORREO_REMITENTE: z.string().default('Contafi <no-responder@contafi.co>'),
  URL_SITIO: z.url().default('http://localhost:3000'),
});

let cache: z.infer<typeof esquema> | undefined;

/** Variables de entorno validadas (se leen al primer uso, no al compilar). */
export function entorno() {
  cache ??= esquema.parse(process.env);
  return cache;
}
