import type { Metadata } from 'next';
import Link from 'next/link';
import { ARTICULOS, CATEGORIAS } from '@/contenido/ayuda.ts';

export const metadata: Metadata = { title: 'Ayuda' };

export default function Ayuda() {
  return (
    <main className="contenedor seccion">
      <h1>Ayuda</h1>
      <p className="entrada">Guías cortas de las tareas principales. ¿No encuentras algo? <Link href="/soporte">Escríbenos</Link>.</p>
      {CATEGORIAS.map((c) => (
        <section key={c} className="categoria">
          <h2>{c}</h2>
          <div className="rejilla">
            {ARTICULOS.filter((a) => a.categoria === c).map((a) => (
              <Link key={a.slug} href={`/ayuda/${a.slug}`} className="tarjeta enlace-tarjeta"><h3>{a.titulo}</h3><p>{a.resumen}</p></Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
