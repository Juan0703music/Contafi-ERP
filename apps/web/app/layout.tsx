import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Contafi',
  description: 'Software contable multi-empresa para contadores en Colombia. Funciona sin internet.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
