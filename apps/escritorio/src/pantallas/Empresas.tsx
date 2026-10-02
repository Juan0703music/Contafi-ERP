import { useState } from 'react';
import { resumenEmpresa, sincronizar } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, dinero, fechaCorta, haceCuanto } from '../componentes/comunes.tsx';
import { esAdministrador } from '../datos/firma.ts';
import { NuevaEmpresa } from './NuevaEmpresa.tsx';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Panel del contador: todas sus empresas en una sola vista (sección 11.1). */
export function Empresas() {
  const { base, empresas, empresa, firmas, version, transporte, dispositivo, cambiarEmpresa, ir, refrescar, avisar } = useApp();
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const admin = esAdministrador(firmas.find((f) => f.id === empresa.firma_id));
  const { firma } = useApp();
  const { datos: suscripcion } = useDatos(() => firma.suscripcion(empresa.firma_id), [firma, empresa.firma_id, empresas.length]);
  const alLimite = !!suscripcion && suscripcion.empresas >= suscripcion.empresas_max;
  const { datos } = useDatos(() => Promise.all(empresas.map((e) => resumenEmpresa(base, e.id))), [base, empresas, version]);

  async function sincronizarTodas() {
    let enviados = 0, errores = 0;
    for (const e of empresas) {
      setSincronizando(e.id);
      const r = await sincronizar(base, transporte, { empresa: e.id, dispositivo });
      enviados += r.contabilizados;
      if (r.error) errores++;
    }
    setSincronizando(null);
    refrescar();
    avisar(errores ? `${errores} empresa(s) no se pudieron sincronizar (sin conexión).` : `Todas sincronizadas${enviados ? `: ${enviados} comprobante(s) con número oficial` : ''}.`, errores ? 'danger' : 'ok');
  }

  const conAlertas = datos?.filter((r) => r.alertas.length).length ?? 0;
  return (
    <>
      <div className="page-head split">
        <div><h1>Mis empresas</h1><p>{empresas.length} empresa(s){conAlertas ? ` · ${conAlertas} requieren atención` : ' · todo al día'}.</p></div>
        <div className="btn-row">
          {suscripcion && <span className="chip" title={`Plan ${suscripcion.nombre}`}>{suscripcion.empresas} de {suscripcion.empresas_max} empresas</span>}
          {admin && <button className="btn" disabled={alLimite || suscripcion?.activa === false}
            title={alLimite ? 'Llegaste al límite de empresas de tu plan' : undefined} onClick={() => setNueva(true)}><Icono nombre="plus" />Nueva empresa</button>}
          <button className="btn primary" disabled={sincronizando !== null} onClick={() => void sincronizarTodas()}>
            <Icono nombre="arrowUpRight" />{sincronizando ? 'Sincronizando…' : 'Sincronizar todas'}</button></div>
      </div>
      <div className="panel">
        <div className="table-wrap"><table>
          <thead><tr><th className="wrap">Empresa</th><th>Última sincronización</th><th className="num">Pendientes</th><th>Meses sin cerrar</th><th className="wrap">Próximo vencimiento</th><th className="num">Utilidad del año</th><th className="wrap">Atención</th><th></th></tr></thead>
          <tbody>{empresas.map((e, i) => {
            const r = datos?.[i];
            return (
              <tr key={e.id}>
                <td className="wrap"><b>{e.razon_social}</b><div className="hint mono">NIT {e.nit}{e.dv != null ? `-${e.dv}` : ''}</div></td>
                <td>{sincronizando === e.id ? <span className="pill open">Sincronizando…</span> : haceCuanto(r?.sync.ultimaSincronizacion ?? null)}</td>
                <td className="num mono">{r?.sync.pendientes || ''}</td>
                <td>{r?.mesesSinCerrar.map((m) => MESES[m - 1]).join(', ')}</td>
                <td className="wrap">{r?.vencimientos[0] ? <>
                  <span className={`pill ${r.vencimientos[0].dias <= 7 ? 'draft' : ''}`}>{fechaCorta(r.vencimientos[0].fecha)}</span> {r.vencimientos[0].nombre}</> : ''}</td>
                <td className="num mono">{r ? dinero(r.utilidadAnio) : ''}</td>
                <td className="wrap">{r?.alertas.length ? r.alertas.map((a) => <span key={a} className="pill draft" style={{ margin: '2px 4px 2px 0' }}>{a}</span>) : <span className="pill posted">Al día</span>}</td>
                <td className="btn-row"><button className="btn ghost sm" onClick={() => { cambiarEmpresa(e.id); ir('panel'); }}>Abrir<Icono nombre="arrowRight" /></button></td>
              </tr>);
          })}</tbody></table></div>
      </div>
      {nueva && <NuevaEmpresa alCerrar={() => setNueva(false)} />}
    </>
  );
}
