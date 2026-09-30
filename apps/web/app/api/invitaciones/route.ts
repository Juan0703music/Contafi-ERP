import { z } from 'zod';
import { entorno } from '@/lib/entorno.ts';
import { ErrorHttp, leerJson, ok, responderError, tokenDe } from '@/lib/http.ts';
import { clienteDelUsuario, traducirError } from '@/lib/supabase.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['SuperAdmin', 'Contador', 'AuxContable', 'Tesorero', 'Gerente', 'Auditor'] as const;

const solicitud = z.object({
  firma_id: z.uuid(),
  correo: z.email().max(200),
  rol_firma: z.enum(['administrador', 'miembro']).default('miembro'),
  empresas: z.array(z.object({ empresa_id: z.uuid(), rol: z.enum(ROLES) })).max(500).default([]),
});

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * POST /api/invitaciones — un administrador (con MFA) invita a alguien a la firma y a sus empresas.
 * La base de datos genera el token y guarda solo su hash; aquí se envía por correo y se descarta.
 */
export async function POST(req: Request) {
  try {
    const sb = clienteDelUsuario(tokenDe(req));
    const s = solicitud.parse(await leerJson(req));
    const { RESEND_API_KEY, CORREO_REMITENTE, URL_SITIO } = entorno();
    if (!RESEND_API_KEY) throw new ErrorHttp(503, 'CORREO_NO_CONFIGURADO', 'El envío de correos no está configurado.');

    const { data, error } = await sb.rpc('invitar_usuario', {
      p_firma: s.firma_id, p_correo: s.correo, p_rol_firma: s.rol_firma, p_empresas: s.empresas,
    });
    if (error) throw traducirError(error);
    const { id, token } = data as { id: string; token: string };

    const { data: firma } = await sb.from('firmas').select('nombre').eq('id', s.firma_id).single();
    // El token va en el fragmento (#): los navegadores no lo envían al servidor ni queda en registros.
    const enlace = `${URL_SITIO}/invitacion#token=${token}`;
    const envio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: CORREO_REMITENTE,
        to: [s.correo],
        subject: `Te invitaron a ${firma?.nombre ?? 'una firma'} en Contafi`,
        html: `<p>Te invitaron a unirte a <strong>${escapar(firma?.nombre ?? 'una firma contable')}</strong> en Contafi.</p>
               <p><a href="${escapar(enlace)}">Aceptar la invitación</a> (vence en 7 días).</p>
               <p>Si no esperabas este correo, ignóralo.</p>`,
      }),
    });
    if (!envio.ok) {
      await sb.rpc('revocar_invitacion', { p_id: id }); // sin correo, la invitación no sirve
      throw new ErrorHttp(502, 'CORREO_FALLO', 'No se pudo enviar el correo de invitación. Intente de nuevo.');
    }
    return ok({ id }, 201);
  } catch (e) {
    return responderError(e);
  }
}
