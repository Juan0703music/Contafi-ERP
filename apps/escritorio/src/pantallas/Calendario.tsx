import { useState } from 'react';
import { PLANTILLA_CALENDARIO, calendariosCargados, catalogoObligaciones, leerCalendarioCsv, obligacionesEmpresa, type LecturaCalendario } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Vacio, fechaCorta } from '../componentes/comunes.tsx';

/**
 * Calendario tributario y obligaciones de la empresa (panel del contador: vencimientos). Contafi no trae
 * las fechas: se copian del decreto del calendario del año en la plantilla y se cargan aquí.
 */
export function CalendarioTributario() {
  const { base, empresa, version, refrescar, avisar, impuestos, sincronizarAhora } = useApp();
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [lectura, setLectura] = useState<LecturaCalendario | null>(null);
  const [marcadas, setMarcadas] = useState<string[] | null>(null);
  const { datos } = useDatos(async () => ({
    calendarios: await calendariosCargados(base),
    catalogo: await catalogoObligaciones(base),
    propias: await obligacionesEmpresa(base, empresa.id),
  }), [base, empresa.id, version]);
  const seleccion = marcadas ?? datos?.propias ?? [];

  function descargarPlantilla() {
    // Con BOM para que Excel reconozca las tildes.
    const url = URL.createObjectURL(new Blob(['﻿' + PLANTILLA_CALENDARIO], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: `calendario-tributario-${anio}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  async function trabajar(fn: () => Promise<void>, ok: string) {
    try {
      await fn();
      if (impuestos.compartida) await sincronizarAhora();
      avisar(ok, 'ok');
      refrescar();
    } catch (e) { avisar((e as Error).message, 'danger'); }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Calendario tributario</h2>
          <button className="btn sm" onClick={descargarPlantilla}><Icono nombre="file" />Descargar plantilla</button></div>
        <div className="panel-body">
          <p className="hint" style={{ marginTop: 0 }}>Copia en la plantilla las fechas del decreto del calendario tributario del año: una fila por obligación,
            período y último dígito del NIT (vacío si aplica a todos). Las filas de la plantilla son solo un ejemplo.
            {impuestos.compartida && ' El calendario es de toda la firma.'}</p>
          <div className="filtros-reporte">
            <div className="field"><label htmlFor="cAnio">Año</label><input id="cAnio" type="number" min={2000} max={2100} value={anio} onChange={(e) => { setAnio(e.target.value); setLectura(null); }} /></div>
            <div className="field"><label htmlFor="cArchivo">Archivo CSV</label>
              <input id="cArchivo" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => setLectura(leerCalendarioCsv(t, Number(anio)))); }} /></div>
            <button className="btn primary" disabled={!lectura?.filas.length || lectura.errores.length > 0}
              onClick={() => void trabajar(() => impuestos.guardarCalendario(empresa.id, Number(anio), lectura!.filas), `Calendario ${anio} guardado (${lectura!.filas.length} fechas).`).then(() => setLectura(null))}>
              Guardar calendario {anio}</button>
          </div>
          {lectura && lectura.errores.length > 0 && <div className="notice danger"><b>Corrija el archivo:</b><ul>{lectura.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
          {lectura && !lectura.errores.length && <p className="hint">{lectura.filas.length} fechas leídas, de {fechaCorta(lectura.filas.map((f) => f.fecha).sort()[0]!)} a {fechaCorta(lectura.filas.map((f) => f.fecha).sort().at(-1)!)}.</p>}
          {datos?.calendarios.length
            ? <p className="hint" style={{ marginBottom: 0 }}>Cargados: {datos.calendarios.map((c) => `${c.anio} (${c.filas.length} fechas)`).join(' · ')}</p>
            : <div className="notice warn" style={{ marginBottom: 0 }}>Sin calendario cargado, el panel no puede avisar los vencimientos.</div>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Obligaciones de {empresa.razon_social}</h2>
          <button className="btn primary sm" disabled={!datos?.catalogo.length || marcadas === null}
            onClick={() => void trabajar(() => impuestos.guardarObligaciones(empresa.id, seleccion), 'Obligaciones guardadas.').then(() => setMarcadas(null))}>Guardar obligaciones</button></div>
        {datos?.catalogo.length ? (
          <div className="panel-body"><div className="btn-row">{datos.catalogo.map((o) => (
            <label key={o.codigo} className="chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" aria-label={`Obligación ${o.codigo}`} checked={seleccion.includes(o.codigo)}
                onChange={(e) => setMarcadas(e.target.checked ? [...seleccion, o.codigo] : seleccion.filter((x) => x !== o.codigo))} /> {o.nombre}
            </label>))}</div>
            <p className="hint" style={{ marginBottom: 0 }}>Los vencimientos se calculan con el último dígito del NIT ({empresa.nit.slice(-1)}).</p></div>
        ) : <Vacio icono="calendar">Carga primero el calendario del año para elegir las obligaciones de la empresa.</Vacio>}
      </div>
    </>
  );
}
