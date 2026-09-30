import { useState } from 'react';
import { calcularDV } from '@contafi/shared';
import { crearTercero, tercerosLocales, ErrorLocal } from '@contafi/local';
import { TIPOS_TERCERO } from '@contafi/sync';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio } from '../componentes/comunes.tsx';

const TIPOS_DOC: Record<string, string> = { '31': 'NIT', '13': 'Cédula', '22': 'Cédula de extranjería', '41': 'Pasaporte' };

export function Terceros() {
  const { base, empresa, version } = useApp();
  const [buscar, setBuscar] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const { datos } = useDatos(() => tercerosLocales(base, empresa.id, buscar.trim()), [base, empresa.id, version, buscar]);

  return (
    <>
      <div className="page-head"><h1>Terceros</h1><p>Clientes, proveedores y empleados. Se pueden crear sin conexión.</p></div>
      <div className="panel">
        <div className="panel-head"><h2>Directorio</h2>
          <div className="btn-row">
            <input type="search" placeholder="Buscar por nombre o documento…" aria-label="Buscar tercero" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 260 }} />
            <button className="btn primary sm" onClick={() => setNuevo(true)}><Icono nombre="plus" />Nuevo tercero</button>
          </div></div>
        {datos?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Documento</th><th className="wrap">Nombre / razón social</th><th>Tipo</th><th>Correo</th><th>Estado</th></tr></thead>
            <tbody>{datos.map((t) => (
              <tr key={t.id}>
                <td className="mono">{TIPOS_DOC[t.tipo_doc] ?? t.tipo_doc} {t.numero}{t.dv != null ? `-${t.dv}` : ''}</td>
                <td className="wrap">{t.nombre}</td>
                <td>{t.tipos.join(', ')}</td>
                <td>{t.correo ?? ''}</td>
                <td>{t.errores_sync ? <span className="pill annulled" title={t.errores_sync}>Rechazado</span>
                  : t.pendiente ? <span className="pill draft">Pendiente</span> : <span className="pill posted">Sincronizado</span>}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="users">{datos ? 'No hay terceros que coincidan.' : 'Cargando…'}</Vacio>}
      </div>
      {nuevo && <NuevoTercero alCerrar={() => setNuevo(false)} />}
    </>
  );
}

function NuevoTercero({ alCerrar }: { alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [tipoDoc, setTipoDoc] = useState('31');
  const [numero, setNumero] = useState('');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [tipos, setTipos] = useState<string[]>(['cliente']);
  const [error, setError] = useState<string | null>(null);
  const limpio = numero.replace(/\D/g, '');
  let dv: number | null = null;
  try { dv = tipoDoc === '31' && limpio ? calcularDV(limpio) : null; } catch { dv = null; }

  async function guardar() {
    setError(null);
    try {
      await crearTercero(base, empresa.id, {
        tipo_doc: tipoDoc, numero: tipoDoc === '31' || tipoDoc === '13' ? limpio : numero.trim(), dv, nombre, correo: correo.trim() || null,
        tipos: tipos as (typeof TIPOS_TERCERO)[number][],
      });
      avisar('Tercero guardado.', 'ok');
      refrescar();
      alCerrar();
      void sincronizarAhora();
    } catch (e) {
      setError(e instanceof ErrorLocal ? e.message : (e as Error).message);
    }
  }

  return (
    <Modal titulo="Nuevo tercero" alCerrar={alCerrar} pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      <div className="grid2">
        <div className="field"><label htmlFor="tTipo">Tipo de documento</label>
          <select id="tTipo" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
            {Object.entries(TIPOS_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="field"><label htmlFor="tNum">Número{dv != null ? ` (DV ${dv})` : ''}</label>
          <input id="tNum" className="mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={tipoDoc === '31' ? '900123456' : ''} /></div>
      </div>
      <div className="field"><label htmlFor="tNombre">Nombre o razón social</label><input id="tNombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
      <div className="field"><label htmlFor="tCorreo">Correo (opcional)</label><input id="tCorreo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
      <div className="field"><label>Es</label>
        <div className="btn-row">{TIPOS_TERCERO.map((t) => (
          <label key={t} className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={tipos.includes(t)} onChange={(e) => setTipos((x) => (e.target.checked ? [...x, t] : x.filter((y) => y !== t)))} /> {t}
          </label>))}</div></div>
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
