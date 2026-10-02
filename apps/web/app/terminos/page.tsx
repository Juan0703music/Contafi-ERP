import type { Metadata } from 'next';
import Link from 'next/link';
import { TERMINOS } from '@/contenido/legal.ts';

export const metadata: Metadata = { title: 'Términos y condiciones y licencia de uso' };

export default function Pagina() {
  const texto = TERMINOS;
  return (
    <main className="contenedor seccion articulo">
      <h1>Términos y condiciones y licencia de uso</h1>
      {texto ? <>
        <p className="migas">Versión {texto.version} · vigente desde {texto.vigenteDesde}</p>
        {texto.parrafos.map((p, i) => <p key={i}>{p}</p>)}
      </> : <div className="tarjeta"><p>Este documento está en preparación con nuestro abogado y se publicará antes del lanzamiento comercial. Si tienes preguntas, <Link href="/soporte">escríbenos</Link>.</p></div>}
    </main>
  );
}
