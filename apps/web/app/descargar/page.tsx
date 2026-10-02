import type { Metadata } from 'next';
import Link from 'next/link';
import { SITIO } from '@/lib/sitio.ts';

export const metadata: Metadata = { title: 'Descargar' };

export default function Descargar() {
  return (
    <main className="contenedor seccion">
      <h1>Descargar Contafi para Windows</h1>
      {SITIO.urlDescarga
        ? <p><a className="boton primario" href={SITIO.urlDescarga}>Descargar el instalador</a></p>
        : <div className="tarjeta"><p>Contafi está en etapa piloto: el instalador se entrega a los contadores del piloto. <Link href="/soporte">Escríbenos</Link> para participar.</p></div>}
      <div className="rejilla">
        <article className="tarjeta"><h2>Requisitos</h2><ul>
          <li>Windows 10 u 11 de 64 bits.</li>
          <li>4 GB de RAM para trabajar; 8 GB o más para la IA local de Jarvis.</li>
          <li>300 MB libres (la IA local ocupa 2,5 GB más si la descargas).</li>
          <li>Internet para sincronizar; el trabajo diario funciona sin conexión.</li>
        </ul></article>
        <article className="tarjeta"><h2>Si Windows muestra una advertencia</h2>
          <p>Al abrir el instalador, Windows puede mostrar «Windows protegió su PC» (SmartScreen) mientras el instalador gana reputación. Elige <b>Más información</b> y luego <b>Ejecutar de todas formas</b>.</p>
          <p>Descarga Contafi solo desde este sitio.</p></article>
      </div>
      <p><Link href="/ayuda/instalar-windows">Guía de instalación paso a paso</Link></p>
    </main>
  );
}
