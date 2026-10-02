import type { Metadata } from 'next';
import Link from 'next/link';
import { PRIVACIDAD } from '@/contenido/legal.ts';

export const metadata: Metadata = { title: 'Política de tratamiento de datos personales' };

export default function Pagina() {
  const texto = PRIVACIDAD;
  return (
    <main className="contenedor seccion articulo">
      <h1>Política de tratamiento de datos personales</h1>
      {texto ? <>
        <p className="migas">Versión {texto.version} · vigente desde {texto.vigenteDesde}</p>
        {texto.parrafos.map((p, i) => <p key={i}>{p}</p>)}
      </> : <div className="tarjeta"><p>Este documento está en preparación con nuestro abogado y se publicará antes del lanzamiento comercial. Si tienes preguntas, <Link href="/soporte">escríbenos</Link>.</p></div>}
    </main>
  );
}
