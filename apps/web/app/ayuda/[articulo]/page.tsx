import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ARTICULOS } from '@/contenido/ayuda.ts';

export function generateStaticParams() {
  return ARTICULOS.map((a) => ({ articulo: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ articulo: string }> }): Promise<Metadata> {
  const { articulo } = await params;
  const a = ARTICULOS.find((x) => x.slug === articulo);
  return { title: a?.titulo ?? 'Ayuda', description: a?.resumen };
}

export default async function Articulo({ params }: { params: Promise<{ articulo: string }> }) {
  const { articulo } = await params;
  const a = ARTICULOS.find((x) => x.slug === articulo);
  if (!a) notFound();
  return (
    <main className="contenedor seccion articulo">
      <p className="migas"><Link href="/ayuda">Ayuda</Link> · {a.categoria}</p>
      <h1>{a.titulo}</h1>
      <p className="entrada">{a.resumen}</p>
      {a.secciones.map((s) => (
        <section key={s.titulo}><h2>{s.titulo}</h2><ol>{s.pasos.map((p) => <li key={p}>{p}</li>)}</ol></section>
      ))}
      <p className="tarjeta">¿Quedó alguna duda? <Link href="/soporte">Escríbenos a soporte</Link>.</p>
    </main>
  );
}
