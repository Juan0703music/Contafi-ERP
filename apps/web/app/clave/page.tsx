import type { Metadata } from 'next';
import { NuevaClave } from './formulario.tsx';

export const metadata: Metadata = { title: 'Nueva contraseña — Contafi', robots: { index: false } };

/** Destino del enlace "¿Olvidaste tu contraseña?" que envía Supabase Auth desde la app de escritorio. */
export default function Clave() {
  return (
    <main className="contenedor seccion" style={{ maxWidth: 640 }}>
      <h1>Nueva contraseña</h1>
      <p>Escribe tu nueva contraseña de Contafi. Después vuelve a la aplicación e ingresa con ella.</p>
      <NuevaClave />
    </main>
  );
}
