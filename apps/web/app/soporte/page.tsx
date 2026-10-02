import type { Metadata } from 'next';
import Link from 'next/link';
import { SITIO, enlaceWhatsapp } from '@/lib/sitio.ts';

export const metadata: Metadata = { title: 'Soporte' };

export default function Soporte() {
  const whatsapp = enlaceWhatsapp('Hola, necesito ayuda con Contafi.');
  return (
    <main className="contenedor seccion">
      <h1>Soporte</h1>
      <div className="rejilla">
        <article className="tarjeta"><h2>Escríbenos</h2>
          {whatsapp || SITIO.correoSoporte ? <ul>
            {whatsapp && <li><a href={whatsapp}>WhatsApp</a></li>}
            {SITIO.correoSoporte && <li><a href={`mailto:${SITIO.correoSoporte}`}>{SITIO.correoSoporte}</a></li>}
          </ul> : <p>Los canales de soporte se publican al iniciar la comercialización.</p>}
          {SITIO.horarioSoporte && <p><b>Horario:</b> {SITIO.horarioSoporte}.</p>}
        </article>
        <article className="tarjeta"><h2>Tiempos de respuesta</h2><ul>
          <li><b>Crítico</b> (no puedes trabajar o no sincroniza): menos de 4 horas hábiles.</li>
          <li><b>Normal</b>: menos de 1 día hábil.</li>
        </ul><p>En cierre de año, exógena y renta reforzamos el equipo de soporte.</p></article>
        <article className="tarjeta"><h2>Antes de escribir</h2><ol>
          <li>Revisa la <Link href="/ayuda">ayuda</Link>: quizá ya está la respuesta.</li>
          <li>Si es un problema de sincronización: en Contafi ve a <b>Sincronización → Copiar diagnóstico</b> y pégalo en tu mensaje. No incluye montos ni nombres.</li>
        </ol></article>
      </div>
    </main>
  );
}
