import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Contafi — contabilidad multi-empresa para contadores', template: '%s — Contafi' },
  description: 'Software contable multi-empresa para contadores en Colombia. Funciona sin internet, importa las facturas de la DIAN y trae un asesor de IA local.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CO">
      <body>
        <header className="cabecera">
          <div className="contenedor cabecera-fila">
            <Link href="/" className="marca" aria-label="Contafi, inicio"><span className="logo" aria-hidden="true">C</span>Contafi</Link>
            <nav aria-label="Principal">
              <Link href="/precios">Precios</Link>
              <Link href="/descargar">Descargar</Link>
              <Link href="/ayuda">Ayuda</Link>
              <Link href="/soporte">Soporte</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="pie">
          <div className="contenedor pie-fila">
            <span>© {new Date().getFullYear()} Contafi</span>
            <span><Link href="/terminos">Términos</Link> · <Link href="/privacidad">Datos personales</Link></span>
            <span>La responsabilidad profesional sobre la contabilidad es del contador; Contafi es una herramienta.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
