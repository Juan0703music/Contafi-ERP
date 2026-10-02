import { balanceGeneral, estadoResultados } from '@contafi/motor';
import { comprobantesParaReportes, hoyContable, leerComprobantes, vencimientosLocales } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, PillEstado, Vacio, dinero, fechaCorta, haceCuanto } from '../componentes/comunes.tsx';

export function Panel({ nuevoComprobante }: { nuevoComprobante: () => void }) {
  const { base, empresa, version, sync, ir } = useApp();
  const { datos } = useDatos(async () => {
    const { fecha } = hoyContable();
    const cs = await comprobantesParaReportes(base, empresa.id, { incluirPendientes: true });
    const recientes = (await leerComprobantes(base, empresa.id)).slice(-6).reverse();
    return {
      vencimientos: await vencimientosLocales(base, empresa.id, fecha, 30),
      bg: balanceGeneral(cs, fecha),
      er: estadoResultados(cs, { desde: `${fecha.slice(0, 4)}-01-01`, hasta: fecha }),
      recientes,
    };
  }, [base, empresa.id, version]);
  const e = sync.estado;

  const kpi = (etiqueta: string, valor: bigint, icono: string, tono = '', sub = '') => (
    <div className="kpi-card">
      <div className="kpi-top"><span className={`kpi-ic ${tono}`}><Icono nombre={icono} /></span><span className="kpi-label">{etiqueta}</span></div>
      <div className={`kpi-value${valor < 0n ? ' neg' : ''}`}>{dinero(valor)}</div>
      {sub && <div className="kpi-foot"><span className="kpi-sub">{sub}</span></div>}
    </div>
  );

  return (
    <>
      <div className="page-head split">
        <div>
          <div className="crumb">{empresa.razon_social}</div>
          <h1>Panel general</h1>
          <p>Saldos a hoy {e?.pendientes ? 'incluyendo lo pendiente de sincronizar' : 'con todo sincronizado'}.</p>
        </div>
        <div className="btn-row"><button className="btn primary" onClick={nuevoComprobante}><Icono nombre="plus" />Nuevo comprobante</button></div>
      </div>

      {e?.alerta && (
        <div className="notice warn"><b>Este equipo lleva {e.diasSinSincronizar ?? 'varios'} días sin sincronizar.</b> Conéctese a internet para que sus comprobantes reciban número oficial.</div>
      )}
      {!!e?.pendientes && !e.alerta && (
        <div className="notice info">Hay <b>{e.pendientes} registro(s) pendientes de sincronizar</b>. Los saldos son provisionales, a la última sincronización ({haceCuanto(e.ultimaSincronizacion)}).</div>
      )}

      {datos && (
        <div className="kpi-grid">
          {kpi('Total activos', datos.bg.activo, 'wallet')}
          {kpi('Total pasivos', datos.bg.pasivo, 'card', 'indigo')}
          {kpi('Patrimonio', datos.bg.patrimonio + datos.bg.resultadoDelEjercicio, 'pie', 'sky', 'Incluye el resultado del ejercicio')}
          {kpi('Utilidad del año', datos.er.utilidadNeta, datos.er.utilidadNeta < 0n ? 'trendingDown' : 'trendingUp', datos.er.utilidadNeta < 0n ? 'danger' : '', `Ingresos ${dinero(datos.er.ingresosOperacionales)}`)}
        </div>
      )}

      {datos && datos.vencimientos.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Próximos vencimientos</h2><button className="btn ghost sm" onClick={() => ir('impuestos')}>Calendario<Icono nombre="arrowRight" /></button></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th className="wrap">Obligación</th><th>Período</th><th>Faltan</th></tr></thead>
            <tbody>{datos.vencimientos.map((v) => (
              <tr key={`${v.obligacion}-${v.periodo}-${v.fecha}`}>
                <td>{fechaCorta(v.fecha)}</td><td className="wrap">{v.nombre}</td><td className="mono">{v.periodo}</td>
                <td>{v.dias === 0 ? <span className="pill annulled">Hoy</span> : v.dias <= 7 ? <span className="pill draft">{v.dias} día(s)</span> : `${v.dias} días`}</td>
              </tr>))}
            </tbody></table></div>
        </div>)}

      <div className="panel">
        <div className="panel-head"><h2>Últimos comprobantes</h2><button className="btn ghost sm" onClick={() => ir('comprobantes')}>Ver todos<Icono nombre="arrowRight" /></button></div>
        {datos?.recientes.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Número</th><th>Fecha</th><th className="wrap">Concepto</th><th className="num">Valor</th><th>Estado</th></tr></thead>
            <tbody>{datos.recientes.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.numero ?? c.numeroLocal}</td><td>{fechaCorta(c.fecha)}</td><td className="wrap">{c.concepto}</td>
                <td className="num mono">{dinero(c.lineas.reduce((s, l) => s + l.debito, 0n))}</td><td><PillEstado estado={c.estado} /></td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="file">Todavía no hay comprobantes en esta empresa.</Vacio>}
      </div>
    </>
  );
}
