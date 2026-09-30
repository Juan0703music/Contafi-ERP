import { useState } from 'react';
import { leerMontoUsuario } from '@contafi/shared';
import {
  conciliar, conciliarAutomaticamente, cuentasLocales, desconciliar, estadoConciliacion, extractos, guardarExtracto,
  leerExtracto, periodoExtracto, registrarDesdeExtracto, ErrorLocal, type LecturaExtracto,
} from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio, dinero, fechaCorta } from '../componentes/comunes.tsx';

/** Conciliación bancaria asistida (sección 11.1): extracto del banco contra los libros. */
export function Bancos() {
  const { base, empresa, version, refrescar, avisar } = useApp();
  const [extractoId, setExtractoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [selBanco, setSelBanco] = useState<string | null>(null);
  const [selLibro, setSelLibro] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState<string | null>(null);

  const { datos } = useDatos(async () => {
    const lista = await extractos(base, empresa.id);
    const actual = extractoId ?? lista[0]?.id ?? null;
    return { lista, actual, estado: actual ? await estadoConciliacion(base, empresa.id, actual) : null };
  }, [base, empresa.id, version, extractoId]);
  const e = datos?.estado;

  async function auto() {
    const n = await conciliarAutomaticamente(base, empresa.id, e!.extracto.id);
    avisar(n ? `${n} movimiento(s) conciliados automáticamente.` : 'No se encontraron parejas nuevas (mismo valor y fecha cercana).', n ? 'ok' : '');
    refrescar();
  }
  async function manual() {
    await conciliar(base, selBanco!, selLibro!);
    setSelBanco(null); setSelLibro(null);
    refrescar();
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Conciliación bancaria</h1><p>Carga el extracto del banco (CSV) y Contafi lo cruza con los movimientos de la cuenta en libros.</p></div>
        <div className="btn-row">
          {(datos?.lista.length ?? 0) > 0 && (
            <select aria-label="Extracto" value={datos?.actual ?? ''} onChange={(ev) => setExtractoId(ev.target.value)}>
              {datos!.lista.map((x) => <option key={x.id} value={x.id}>{x.cuenta} · {fechaCorta(x.desde)} a {fechaCorta(x.hasta)}</option>)}
            </select>)}
          <button className="btn primary" onClick={() => setCargando(true)}><Icono nombre="plus" />Cargar extracto</button>
        </div>
      </div>

      {!e ? <div className="panel"><Vacio icono="bank">Todavía no has cargado extractos de esta empresa.</Vacio></div> : <>
        <div className="kpi-grid">
          {[['Saldo en libros', e.resumen.saldoLibros], ['Saldo del extracto', e.resumen.saldoExtracto],
            ['En el banco, no en libros', e.resumen.bancoSinRegistrar], ['En libros, no en el banco', e.resumen.librosEnTransito]].map(([t, v]) => (
            <div className="kpi-card" key={t as string}><div className="kpi-top"><span className="kpi-label">{t as string}</span></div><div className="kpi-value">{dinero(v as bigint)}</div></div>))}
        </div>
        <div className={`notice ${e.resumen.diferencia === 0n ? 'info' : 'warn'}`}>
          {e.resumen.diferencia === 0n
            ? <><b>Conciliación cuadrada.</b> Saldo del extracto = saldo en libros − partidas de libros en tránsito + partidas del banco sin registrar.</>
            : <><b>Diferencia sin explicar: {dinero(e.resumen.diferencia)}.</b> Revise movimientos de meses anteriores o errores de digitación.</>}
        </div>
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button className="btn" onClick={() => void auto()}><Icono nombre="sparkles" />Conciliar automáticamente</button>
          <button className="btn" disabled={!selBanco || !selLibro} onClick={() => void manual()}>Conciliar seleccionados</button>
          <span className="hint">Seleccione un movimiento de cada lado para conciliarlos a mano.</span>
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-head"><h2>Extracto del banco</h2></div>
            <div className="table-wrap"><table>
              <thead><tr><th></th><th>Fecha</th><th className="wrap">Descripción</th><th className="num">Valor</th><th></th></tr></thead>
              <tbody>{e.banco.map((b) => (
                <tr key={b.id} style={{ opacity: b.conciliadoCon ? 0.55 : 1 }}>
                  <td>{!b.conciliadoCon && <input type="radio" name="banco" aria-label={`Elegir ${b.descripcion}`} checked={selBanco === b.id} onChange={() => setSelBanco(b.id)} />}</td>
                  <td>{fechaCorta(b.fecha)}</td><td className="wrap">{b.descripcion}</td><td className="num mono">{dinero(b.valor)}</td>
                  <td className="btn-row">{b.conciliadoCon
                    ? <button className="btn ghost sm" onClick={() => void desconciliar(base, b.id).then(refrescar)}>Deshacer</button>
                    : <button className="btn ghost sm" onClick={() => setRegistrar(b.id)}>Registrar</button>}</td>
                </tr>))}</tbody></table></div>
          </div>
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-head"><h2>Libros · cuenta {e.extracto.cuenta}</h2></div>
            <div className="table-wrap"><table>
              <thead><tr><th></th><th>Fecha</th><th className="wrap">Concepto</th><th className="num">Valor</th></tr></thead>
              <tbody>{e.libros.length ? e.libros.map((l) => (
                <tr key={l.id} style={{ opacity: l.conciliadoCon ? 0.55 : 1 }}>
                  <td>{!l.conciliadoCon && <input type="radio" name="libro" aria-label={`Elegir ${l.concepto}`} checked={selLibro === l.id} onChange={() => setSelLibro(l.id)} />}</td>
                  <td>{fechaCorta(l.fecha)}</td><td className="wrap">{l.concepto}</td><td className="num mono">{dinero(l.valor)}</td>
                </tr>)) : <tr><td colSpan={4} className="hint">Sin movimientos en el período.</td></tr>}</tbody></table></div>
          </div>
        </div>
      </>}
      {cargando && <CargarExtracto alCerrar={(id) => { setCargando(false); if (id) { setExtractoId(id); refrescar(); } }} />}
      {registrar && e && <RegistrarMovimiento extractoId={e.extracto.id} linea={e.banco.find((b) => b.id === registrar)!} alCerrar={() => setRegistrar(null)} />}
    </>
  );
}

function CargarExtracto({ alCerrar }: { alCerrar: (id?: string) => void }) {
  const { base, empresa, avisar } = useApp();
  const [cuenta, setCuenta] = useState('');
  const [archivo, setArchivo] = useState<{ nombre: string; lectura: LecturaExtracto } | null>(null);
  const [saldo, setSaldo] = useState('');
  const [periodo, setPeriodo] = useState<{ desde: string; hasta: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { datos: bancos } = useDatos(async () => (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && /^11(10|20)/.test(c.codigo)), [base, empresa.id]);

  async function guardar() {
    const saldoFinal = leerMontoUsuario(saldo);
    if (saldoFinal === null) return setError('Escriba el saldo final que muestra el extracto.');
    try {
      const id = await guardarExtracto(base, empresa.id, cuenta, archivo!.nombre, archivo!.lectura, saldoFinal, periodo!);
      avisar('Extracto cargado.', 'ok');
      alCerrar(id);
    } catch (e) { setError(e instanceof ErrorLocal ? e.message : (e as Error).message); }
  }

  return (
    <Modal titulo="Cargar extracto bancario" alCerrar={() => alCerrar()}
      pie={<><button className="btn" onClick={() => alCerrar()}>Cancelar</button>
        <button className="btn primary" disabled={!cuenta || !archivo?.lectura.movimientos.length || !saldo} onClick={() => void guardar()}>Cargar</button></>}>
      <div className="field"><label htmlFor="bCta">Cuenta del banco</label>
        <select id="bCta" value={cuenta} onChange={(ev) => setCuenta(ev.target.value)}>
          <option value="">Seleccione…</option>
          {bancos?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
        </select></div>
      <div className="field"><label htmlFor="bArch">Extracto (CSV exportado del banco)</label>
        <input id="bArch" type="file" accept=".csv,text/csv" onChange={async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          const lectura = leerExtracto(await f.text());
          setArchivo({ nombre: f.name, lectura });
          if (lectura.movimientos.length) setPeriodo(periodoExtracto(lectura));
        }} /></div>
      {archivo && (archivo.lectura.errores.length
        ? <div className="notice warn"><b>Filas con problemas (se omiten):</b><ul>{archivo.lectura.errores.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        : <p className="hint">{archivo.lectura.movimientos.length} movimientos leídos.</p>)}
      {periodo && (
        <div className="grid3">
          <div className="field"><label htmlFor="bDesde">Período desde</label><input id="bDesde" type="date" value={periodo.desde} onChange={(ev) => setPeriodo({ ...periodo, desde: ev.target.value })} /></div>
          <div className="field"><label htmlFor="bHasta">Hasta</label><input id="bHasta" type="date" value={periodo.hasta} onChange={(ev) => setPeriodo({ ...periodo, hasta: ev.target.value })} /></div>
          <div className="field"><label htmlFor="bSaldo">Saldo final del extracto</label><input id="bSaldo" type="text" className="mono" inputMode="decimal" value={saldo} onChange={(ev) => setSaldo(ev.target.value)} /></div>
        </div>)}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}

function RegistrarMovimiento({ extractoId, linea, alCerrar }: { extractoId: string; linea: { id: string; descripcion: string; valor: bigint; fecha: string }; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [cuenta, setCuenta] = useState(linea.valor < 0n ? '530505' : '421005');
  const [error, setError] = useState<string | null>(null);
  const { datos: auxiliares } = useDatos(async () => (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && c.activa), [base, empresa.id]);

  async function guardar() {
    try {
      const { numeroLocal } = await registrarDesdeExtracto(base, empresa.id, extractoId, linea.id, cuenta);
      avisar(`Comprobante ${numeroLocal} creado y conciliado.`, 'ok');
      refrescar();
      void sincronizarAhora();
      alCerrar();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <Modal titulo="Registrar en libros" alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Crear comprobante</button></>}>
      <p><b>{linea.descripcion}</b> · {fechaCorta(linea.fecha)} · <span className="mono">{dinero(linea.valor)}</span></p>
      <p className="hint">{linea.valor < 0n ? 'Salida del banco (comisión, 4x1000, cargo): se registra como gasto.' : 'Entrada al banco (intereses, abono): se registra como ingreso.'}</p>
      <div className="field"><label htmlFor="rgCta">Cuenta de contrapartida</label>
        <select id="rgCta" value={cuenta} onChange={(ev) => setCuenta(ev.target.value)}>
          {auxiliares?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
        </select></div>
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
