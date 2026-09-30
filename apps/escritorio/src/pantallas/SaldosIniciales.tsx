import { useState } from 'react';
import { ErrorMotor } from '@contafi/motor';
import { PLANTILLA_SALDOS, crearSaldosIniciales, leerSaldosIniciales, type LecturaSaldos } from '@contafi/local';
import { useApp } from '../estado.tsx';
import { Icono, Vacio, dinero } from '../componentes/comunes.tsx';

export function SaldosIniciales() {
  const { base, empresa, avisar, refrescar, sincronizarAhora, ir } = useApp();
  const [lectura, setLectura] = useState<LecturaSaldos | null>(null);
  const [fecha, setFecha] = useState(`${new Date().getFullYear()}-01-01`);
  const [errores, setErrores] = useState<string[]>([]);

  function descargarPlantilla() {
    // Con BOM para que Excel reconozca las tildes.
    const url = URL.createObjectURL(new Blob(['﻿' + PLANTILLA_SALDOS], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla-saldos-iniciales.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function leer(archivo: File) {
    setErrores([]);
    setLectura(await leerSaldosIniciales(base, empresa.id, await archivo.text()));
  }

  async function crear() {
    try {
      const { numeroLocal } = await crearSaldosIniciales(base, empresa.id, fecha, lectura!.lineas);
      avisar(`Comprobante de saldos iniciales ${numeroLocal} creado.`, 'ok');
      refrescar();
      void sincronizarAhora();
      ir('comprobantes');
    } catch (e) {
      setErrores(e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje) : [(e as Error).message]);
    }
  }

  const cuadra = lectura && lectura.totalDebitos === lectura.totalCreditos && lectura.totalDebitos > 0n;
  return (
    <>
      <div className="page-head split">
        <div><h1>Saldos iniciales</h1><p>Carga los saldos con que la empresa empieza en Contafi, desde Excel (guardado como CSV).</p></div>
        <div className="btn-row"><button className="btn" onClick={descargarPlantilla}><Icono nombre="file" />Descargar plantilla</button></div>
      </div>
      <div className="panel">
        <div className="panel-body">
          <ol className="hint" style={{ marginTop: 0 }}>
            <li>Descarga la plantilla y ábrela en Excel: una fila por cuenta auxiliar (y por tercero cuando la cuenta lo exige).</li>
            <li>Los terceros deben existir antes en Contafi (se buscan por NIT o cédula).</li>
            <li>Guarda como <b>CSV</b> y cárgalo aquí. Débitos y créditos deben sumar lo mismo.</li>
          </ol>
          <div className="filtros-reporte">
            <div className="field"><label htmlFor="sArchivo">Archivo CSV</label>
              <input id="sArchivo" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f); }} /></div>
            <div className="field"><label htmlFor="sFecha">Fecha de los saldos</label><input id="sFecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          </div>
        </div>
        {lectura ? (
          <>
            {lectura.errores.length > 0 && <div className="panel-body" style={{ paddingTop: 0 }}><div className="notice danger" style={{ margin: 0 }}><b>Corrija el archivo:</b><ul>{lectura.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div></div>}
            <div className="table-wrap"><table>
              <thead><tr><th>Cuenta</th><th className="wrap">Nota</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
              <tbody>
                {lectura.lineas.map((l, i) => <tr key={i}><td className="mono">{l.cuenta}</td><td className="wrap">{l.nota}</td>
                  <td className="num mono">{l.debito ? dinero(l.debito) : ''}</td><td className="num mono">{l.credito ? dinero(l.credito) : ''}</td></tr>)}
                <tr className="fila-total"><td colSpan={2}>Totales</td><td className="num mono">{dinero(lectura.totalDebitos)}</td><td className="num mono">{dinero(lectura.totalCreditos)}</td></tr>
              </tbody></table></div>
            <div className="panel-body">
              {errores.length > 0 && <div className="notice danger"><ul>{errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
              <div className="btn-row">
                <span className={cuadra ? 'balance-ok' : 'balance-bad'}>{cuadra ? 'Balanceado' : `Diferencia ${dinero(lectura.totalDebitos - lectura.totalCreditos)}`}</span>
                <button className="btn primary" disabled={!cuadra || lectura.errores.length > 0} onClick={() => void crear()}>Crear comprobante de saldos iniciales</button>
              </div>
            </div>
          </>
        ) : <Vacio icono="calendar">Carga el archivo para revisar los saldos antes de crearlos.</Vacio>}
      </div>
    </>
  );
}
