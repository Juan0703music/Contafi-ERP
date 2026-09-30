import { useState } from 'react';
import { ErrorMotor } from '@contafi/motor';
import { generarCierreAnual, hoyContable, resumenPeriodos, vistaCierreAnual } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, dinero } from '../componentes/comunes.tsx';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function Cierres() {
  const { base, empresa, version, cambiarPeriodo, avisar, refrescar, sincronizarAhora } = useApp();
  const [anio, setAnio] = useState(Number(hoyContable().fecha.slice(0, 4)));
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const { datos } = useDatos(async () => ({
    meses: await resumenPeriodos(base, empresa.id, anio),
    anual: await vistaCierreAnual(base, empresa.id, anio),
  }), [base, empresa.id, version, anio]);

  async function cambiar(mes: number, estado: 'abierto' | 'cerrado') {
    setOcupado(mes);
    try {
      await cambiarPeriodo(empresa.id, anio, mes, estado);
      avisar(`${MESES[mes - 1]} de ${anio} quedó ${estado}.`, 'ok');
      refrescar();
      await sincronizarAhora();
    } catch (e) {
      avisar((e as Error).message, 'danger');
    } finally {
      setOcupado(null);
    }
  }

  async function cerrarAnio() {
    try {
      const { numeroLocal } = await generarCierreAnual(base, empresa.id, anio);
      avisar(`Comprobante de cierre ${numeroLocal} creado. Recibirá su número al sincronizar.`, 'ok');
      setConfirmarCierre(false);
      refrescar();
      void sincronizarAhora();
    } catch (e) {
      avisar(e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje).join(' ') : (e as Error).message, 'danger');
    }
  }

  const a = datos?.anual;
  return (
    <>
      <div className="page-head split">
        <div><h1>Períodos y cierres</h1><p>Un mes cerrado no admite comprobantes nuevos. Reabrirlo exige permiso y queda en la auditoría.</p></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="cAnio">Año</label>
          <select id="cAnio" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[0, 1, 2, 3].map((d) => { const y = Number(hoyContable().fecha.slice(0, 4)) - d; return <option key={y} value={y}>{y}</option>; })}
          </select></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Cierres mensuales de {anio}</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Mes</th><th className="num">Comprobantes</th><th>Pendientes</th><th>Estado</th><th></th></tr></thead>
          <tbody>{datos?.meses.map((m) => (
            <tr key={m.mes}>
              <td>{MESES[m.mes - 1]}</td>
              <td className="num mono">{m.comprobantes}</td>
              <td>{m.pendientes ? <span className="pill draft" title="Sincronice antes de cerrar el mes">{m.pendientes} sin número oficial</span> : ''}</td>
              <td>{m.estado === 'cerrado' ? <span className="pill closed">Cerrado</span> : <span className="pill open">Abierto</span>}</td>
              <td className="btn-row">
                {m.estado === 'abierto'
                  ? <button className="btn sm" disabled={ocupado !== null || m.pendientes > 0} title={m.pendientes ? 'Sincronice primero los comprobantes del mes' : ''}
                      onClick={() => void cambiar(m.mes, 'cerrado')}><Icono nombre="lock" clase="sm" />{ocupado === m.mes ? 'Cerrando…' : 'Cerrar'}</button>
                  : <button className="btn ghost sm" disabled={ocupado !== null} onClick={() => void cambiar(m.mes, 'abierto')}>{ocupado === m.mes ? 'Reabriendo…' : 'Reabrir'}</button>}
              </td>
            </tr>))}
          </tbody></table></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Cierre anual {anio}</h2></div>
        <div className="panel-body">
          {a && (a.yaExiste
            ? <div className="notice info" style={{ margin: 0 }}>El comprobante de cierre de {anio} ya fue generado. Para rehacerlo, anúlelo primero.</div>
            : <>
                <p>Cancela las cuentas de resultado (clases 4 a 7) contra <b>{a.utilidadNeta >= 0n ? '3605 Utilidad del ejercicio' : '3610 Pérdida del ejercicio'}</b>, con lo contabilizado oficialmente.</p>
                <div className="total-bar">
                  <span>{a.utilidadNeta >= 0n ? 'Utilidad' : 'Pérdida'} del ejercicio: <b>{dinero(a.utilidadNeta < 0n ? -a.utilidadNeta : a.utilidadNeta)}</b></span>
                  <span>Líneas del comprobante: <b>{a.lineas.length}</b></span>
                </div>
                {a.pendientes > 0 && <div className="notice warn" style={{ marginTop: 12 }}>Hay <b>{a.pendientes} comprobante(s) de {anio} sin número oficial</b>. Sincronice antes de cerrar el año.</div>}
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn primary" disabled={a.pendientes > 0 || a.lineas.length < 2} onClick={() => setConfirmarCierre(true)}>Generar comprobante de cierre</button>
                </div>
              </>)}
        </div>
      </div>
      {confirmarCierre && a && (
        <Modal titulo={`Cierre del ejercicio ${anio}`} alCerrar={() => setConfirmarCierre(false)}
          pie={<><button className="btn" onClick={() => setConfirmarCierre(false)}>Cancelar</button><button className="btn primary" onClick={() => void cerrarAnio()}>Generar cierre</button></>}>
          <p>Se creará el comprobante <b>CC</b> del 31/12/{anio} que deja en cero ingresos, gastos y costos, y lleva {dinero(a.utilidadNeta < 0n ? -a.utilidadNeta : a.utilidadNeta)} a {a.utilidadNeta >= 0n ? 'utilidad' : 'pérdida'} del ejercicio.</p>
          <p className="hint">Como todo comprobante contabilizado, solo se puede corregir anulándolo.</p>
        </Modal>
      )}
    </>
  );
}
