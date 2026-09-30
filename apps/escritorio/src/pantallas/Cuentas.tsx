import { useState } from 'react';
import { cuentasLocales } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Vacio } from '../componentes/comunes.tsx';

export function Cuentas() {
  const { base, empresa, version } = useApp();
  const [buscar, setBuscar] = useState('');
  const { datos } = useDatos(() => cuentasLocales(base, empresa.id), [base, empresa.id, version]);
  const q = buscar.trim().toLowerCase();
  const lista = (datos ?? []).filter((c) => !q || c.codigo.startsWith(q) || c.nombre.toLowerCase().includes(q));
  const nivel = (codigo: string) => (codigo.length === 1 ? 1 : codigo.length === 2 ? 2 : codigo.length === 4 ? 3 : 4);

  return (
    <>
      <div className="page-head"><h1>Plan de cuentas</h1><p>PUC de la empresa. Solo las cuentas auxiliares reciben movimientos.</p></div>
      <div className="panel">
        <div className="panel-head"><h2>{lista.length} cuentas</h2>
          <input type="search" placeholder="Buscar por código o nombre…" aria-label="Buscar cuenta" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 280 }} /></div>
        {lista.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Nombre</th><th>Naturaleza</th><th>Tipo</th><th>Exige tercero</th></tr></thead>
            <tbody>{lista.map((c) => (
              <tr key={c.codigo} className={`acct-tree-row lvl${Math.min(nivel(c.codigo), 3)}`}>
                <td className="mono">{c.codigo}</td>
                <td className="wrap" style={{ paddingLeft: 12 + (nivel(c.codigo) - 1) * 16, fontWeight: c.aceptaMovimiento ? 400 : 600 }}>{c.nombre}</td>
                <td>{c.naturaleza === 'D' ? 'Débito' : 'Crédito'}</td>
                <td>{c.aceptaMovimiento ? <span className="pill posted">Auxiliar</span> : <span className="pill open">Mayor</span>}</td>
                <td>{c.exigeTercero ? 'Sí' : ''}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="tree">{datos ? 'Ninguna cuenta coincide.' : 'Cargando…'}</Vacio>}
      </div>
    </>
  );
}
