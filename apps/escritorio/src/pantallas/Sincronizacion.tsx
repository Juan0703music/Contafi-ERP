import { leerComprobantes, tercerosLocales } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Vacio, fechaCorta, haceCuanto } from '../componentes/comunes.tsx';

export function Sincronizacion() {
  const { base, empresa, version, sync, sincronizarAhora, modo } = useApp();
  const { datos } = useDatos(async () => ({
    rechazados: await leerComprobantes(base, empresa.id, { estados: ['rechazado'] }),
    tercerosError: (await tercerosLocales(base, empresa.id)).filter((t) => t.errores_sync),
    cola: await base.consultar<{ tipo: string; registro_id: string; intentos: number; ultimo_error: string | null }>(
      'select tipo, registro_id, intentos, ultimo_error from cola_salida where empresa_id = ? order by seq limit 50', [empresa.id]),
  }), [base, empresa.id, version, sync.enCurso]);
  const e = sync.estado;

  const mini = (etiqueta: string, valor: string | number, tono = '') => (
    <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">{etiqueta}</span></div><div className={`kpi-value ${tono}`}>{valor}</div></div>
  );

  return (
    <>
      <div className="page-head split">
        <div><h1>Sincronización</h1><p>Lo creado en este equipo se sube a la nube y recibe su número oficial; lo hecho en otros equipos llega aquí.</p></div>
        <div className="btn-row"><button className="btn primary" disabled={sync.enCurso} onClick={() => void sincronizarAhora()}><Icono nombre="arrowUpRight" />{sync.enCurso ? 'Sincronizando…' : 'Sincronizar ahora'}</button></div>
      </div>
      {modo === 'demo' && <div className="notice info"><b>Modo demostración:</b> un servidor simulado en este equipo asigna los números oficiales. Nada sale del PC.</div>}
      {sync.ultimo?.error && <div className="notice warn"><b>No se pudo sincronizar:</b> {sync.ultimo.error} Lo pendiente sigue guardado y se enviará automáticamente.</div>}
      {e?.alerta && <div className="notice danger"><b>Más de 7 días sin sincronizar.</b> Conéctese a internet lo antes posible.</div>}
      {e && (
        <div className="kpi-grid">
          {mini('Pendientes de enviar', e.pendientes, e.pendientes ? 'neg' : '')}
          {mini('Rechazados', e.rechazados + e.tercerosConError, e.rechazados + e.tercerosConError ? 'neg' : '')}
          {mini('Esperando aprobación', e.porAprobar)}
          {mini('Última sincronización', haceCuanto(e.ultimaSincronizacion))}
        </div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Rechazados por el servidor</h2></div>
        {datos?.rechazados.length || datos?.tercerosError.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Registro</th><th>Fecha</th><th className="wrap">Motivo</th></tr></thead>
            <tbody>
              {datos.tercerosError.map((t) => (
                <tr key={t.id}><td>Tercero {t.nombre}</td><td></td><td className="wrap">{(JSON.parse(t.errores_sync!) as { mensaje: string }[]).map((x) => x.mensaje).join(' ')}</td></tr>))}
              {datos.rechazados.map((c) => (
                <tr key={c.id}><td className="mono">{c.numeroLocal}</td><td>{fechaCorta(c.fecha)}</td><td className="wrap">{c.errores.map((x) => x.mensaje).join(' ')}</td></tr>))}
            </tbody></table></div>
        ) : <Vacio icono="circleCheck">No hay rechazos.</Vacio>}
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Cola de salida</h2><span className="hint">En el orden en que se enviarán</span></div>
        {datos?.cola.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Tipo</th><th>Id</th><th className="num">Intentos</th><th className="wrap">Último error</th></tr></thead>
            <tbody>{datos.cola.map((c) => (
              <tr key={c.registro_id}><td>{c.tipo}</td><td className="mono">{c.registro_id.slice(0, 8)}</td><td className="num">{c.intentos}</td><td className="wrap">{c.ultimo_error ?? ''}</td></tr>))}
            </tbody></table></div>
        ) : <Vacio icono="check">Todo está sincronizado.</Vacio>}
      </div>
    </>
  );
}
