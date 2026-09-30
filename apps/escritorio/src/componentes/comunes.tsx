import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICONOS } from '@contafi/ui';
import { formatoCOP, type Centavos } from '@contafi/shared';
import type { EstadoLocal } from '@contafi/local';

export function Icono({ nombre, clase }: { nombre: string; clase?: string }) {
  return <svg className={`ic${clase ? ` ${clase}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONOS[nombre] ?? '' }} />;
}

/** "$ 1.234.567" o "$ 1.234.567,89" si tiene centavos. */
export function dinero(c: Centavos): string {
  return formatoCOP(c, { decimales: c % 100n !== 0n });
}

export function fechaCorta(f: string): string {
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a}`;
}

export function haceCuanto(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

const ESTADOS: Record<EstadoLocal, [string, string]> = {
  contabilizado: ['posted', 'Contabilizado'],
  pendiente_sync: ['draft', 'Pendiente de sincronizar'],
  por_aprobar: ['draft', 'Por aprobar'],
  rechazado: ['annulled', 'Rechazado'],
  anulado: ['annulled', 'Anulado'],
};

export function PillEstado({ estado }: { estado: EstadoLocal }) {
  const [clase, texto] = ESTADOS[estado];
  return <span className={`pill ${clase}`}>{texto}</span>;
}

export function Modal({ titulo, ancho, alCerrar, pie, children }: {
  titulo: string; ancho?: boolean | 'xl'; alCerrar: () => void; pie?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', tecla);
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', tecla);
  }, [alCerrar]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div ref={ref} className={`modal${ancho ? ' wide' : ''}${ancho === 'xl' ? ' xl' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modalTitulo">
        <div className="modal-head">
          <h3 id="modalTitulo">{titulo}</h3>
          <button className="btn ghost icon close-x" aria-label="Cerrar" onClick={alCerrar}><Icono nombre="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {pie && <div className="modal-foot">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Vacio({ icono = 'info', children }: { icono?: string; children: ReactNode }) {
  return <div className="empty"><div className="big"><Icono nombre={icono} /></div>{children}</div>;
}
