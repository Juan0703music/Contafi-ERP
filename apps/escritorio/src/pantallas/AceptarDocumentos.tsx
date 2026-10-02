import { useState } from 'react';
import { Icono } from '../componentes/comunes.tsx';
import { MarcoAcceso } from './Acceso.tsx';

export interface DocumentoLegal { codigo: string; version: string; titulo: string; url: string }

/**
 * Antes de usar la nube, la persona acepta la versión vigente de los términos y la política de datos.
 * La aceptación queda registrada en el servidor (Ley 1581 de 2012: prueba de la autorización).
 */
export function AceptarDocumentos({ documentos, urlSitio, alAceptar, alSalir }: {
  documentos: DocumentoLegal[];
  urlSitio: string;
  alAceptar: () => Promise<void>;
  alSalir: () => Promise<void>;
}) {
  const [acepto, setAcepto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enlace = (url: string) => (url.startsWith('http') ? url : `${urlSitio}${url}`);

  async function aceptar() {
    setError(null);
    setOcupado(true);
    try { await alAceptar(); } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }

  return (
    <MarcoAcceso>
      <section className="login-card" aria-labelledby="tituloAcceso">
        <div><h2 id="tituloAcceso">Antes de continuar</h2>
          <p className="login-lead">Para usar Contafi en la nube debes leer y aceptar:</p></div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {documentos.map((d) => <li key={d.codigo}><a href={enlace(d.url)} target="_blank" rel="noreferrer">{d.titulo}</a> (versión {d.version})</li>)}
        </ul>
        <label className="chip" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} /> He leído y acepto estos documentos</label>
        {error && <div className="notice danger" role="alert">{error}</div>}
        <button className="btn primary block" disabled={!acepto || ocupado} onClick={() => void aceptar()}>{ocupado ? 'Guardando…' : 'Aceptar y continuar'}<Icono nombre="arrowRight" /></button>
        <button type="button" className="btn ghost block" onClick={() => void alSalir()}><Icono nombre="logout" />Cerrar sesión</button>
      </section>
    </MarcoAcceso>
  );
}
