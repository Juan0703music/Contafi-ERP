/** Datos públicos del sitio (configurables en Vercel). Sin valor, la página lo dice en lugar de inventarlo. */
export const SITIO = {
  correoSoporte: process.env.NEXT_PUBLIC_SOPORTE_CORREO ?? '',
  whatsappSoporte: process.env.NEXT_PUBLIC_SOPORTE_WHATSAPP ?? '', // solo dígitos, con indicativo: 573001234567
  horarioSoporte: process.env.NEXT_PUBLIC_SOPORTE_HORARIO ?? '',
  urlDescarga: process.env.NEXT_PUBLIC_URL_DESCARGA ?? '',
};

export const enlaceWhatsapp = (texto: string) =>
  SITIO.whatsappSoporte ? `https://wa.me/${SITIO.whatsappSoporte.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}` : '';
