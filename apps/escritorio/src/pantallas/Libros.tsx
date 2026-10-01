import { useState } from 'react';
import { libroDiario, libroMayor, auxiliar, auxiliarImpuestos } from '@contafi/motor';
import { comprobantesParaReportes, cuentasLocales, hoyContable, tercerosLocales } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Vacio, dinero, fechaCorta } from '../componentes/comunes.tsx';
import { BotonesReporte, EncabezadoImpresion, Pestanas, aPesos, exportarExcel } from '../componentes/reportes.tsx';

type Libro = 'diario' | 'mayor' | 'auxiliar' | 'impuestos';
const conLado = (s: bigint) => (s === 0n ? dinero(0n) : `${dinero(s < 0n ? -s : s)} ${s > 0n ? 'Db' : 'Cr'}`);

export function Libros() {
  const { base, empresa, version } = useApp();
  const hoy = hoyContable().fecha;
  const [libro, setLibro] = useState<Libro>('diario');
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [cuenta, setCuenta] = useState('1105');
  const [tercero, setTercero] = useState('');

  const { datos } = useDatos(async () => {
    const [cuentas, comprobantes, terceros] = await Promise.all([
      cuentasLocales(base, empresa.id), comprobantesParaReportes(base, empresa.id), tercerosLocales(base, empresa.id),
    ]);
    return { cuentas, comprobantes, terceros, nombresTercero: new Map(terceros.map((t) => [t.id, t.nombre])) };
  }, [base, empresa.id, version]);

  const periodo = `${fechaCorta(desde)} a ${fechaCorta(hasta)}`;
  const diario = datos && libro === 'diario' ? libroDiario(datos.cuentas, datos.comprobantes, { desde, hasta }) : null;
  const mayor = datos && libro === 'mayor' ? libroMayor(datos.cuentas, datos.comprobantes, { desde, hasta }) : null;
  const aux = datos && libro === 'auxiliar' ? auxiliar(datos.comprobantes, cuenta, { desde, hasta, terceroId: tercero || undefined }) : null;
  const imp = datos && libro === 'impuestos' ? auxiliarImpuestos(datos.cuentas, datos.comprobantes, { desde, hasta }) : null;
  const nombreTercero = (id: string | null) => (id ? datos!.nombresTercero.get(id) ?? '' : '');
  const [porTercero, setPorTercero] = useState(false);
  const nombreArchivo = `${libro}-${empresa.nit}-${desde}-a-${hasta}`;

  async function exportar() {
    if (diario) {
      await exportarExcel(nombreArchivo, 'Libro diario', ['Fecha', 'Comprobante', 'Concepto', 'Cuenta', 'Nombre de la cuenta', 'Tercero', 'Débito', 'Crédito'],
        diario.asientos.flatMap((a) => a.lineas.map((l) => [fechaCorta(a.fecha), a.numero, a.concepto, l.cuenta, l.nombreCuenta,
          l.terceroId ? datos!.nombresTercero.get(l.terceroId) ?? '' : '', aPesos(l.debito), aPesos(l.credito)])));
    } else if (mayor) {
      await exportarExcel(nombreArchivo, 'Mayor y balances', ['Código', 'Cuenta', 'Saldo inicial', 'Débitos', 'Créditos', 'Saldo final'],
        mayor.filas.map((f) => [f.codigo, f.nombre, aPesos(f.saldoInicial), aPesos(f.debitos), aPesos(f.creditos), aPesos(f.saldoFinal)]));
    } else if (imp) {
      await exportarExcel(nombreArchivo, 'Auxiliar de impuestos', ['Cuenta', 'Nombre de la cuenta', 'Fecha', 'Comprobante', 'Concepto', 'Tercero', 'Base', 'Débito', 'Crédito'],
        imp.grupos.flatMap((g) => g.cuentas.flatMap((c) => c.movimientos.map((m) => [c.cuenta, c.nombre, fechaCorta(m.fecha), m.numero, m.nota ?? m.concepto,
          nombreTercero(m.terceroId), m.base == null ? null : aPesos(m.base), aPesos(m.debito), aPesos(m.credito)]))));
    } else if (aux) {
      await exportarExcel(nombreArchivo, 'Auxiliar', ['Fecha', 'Comprobante', 'Concepto', 'Tercero', 'Débito', 'Crédito', 'Saldo'],
        [[null, null, 'Saldo inicial', null, null, null, aPesos(aux.saldoInicial)],
          ...aux.filas.map((f) => [fechaCorta(f.fecha), f.numero, f.concepto, f.terceroId ? datos!.nombresTercero.get(f.terceroId) ?? '' : '',
            aPesos(f.debito), aPesos(f.credito), aPesos(f.saldo)])]);
    }
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Libros</h1><p>Libro diario, mayor y balances, auxiliares y auxiliar de impuestos, con lo contabilizado oficialmente.</p></div>
        <BotonesReporte alExportar={exportar} />
      </div>
      <div className="panel">
        <div className="panel-body no-imprimir">
          <div className="filtros-reporte">
            <Pestanas etiqueta="Libro" valor={libro} cambiar={setLibro} opciones={[['diario', 'Diario'], ['mayor', 'Mayor y balances'], ['auxiliar', 'Auxiliar'], ['impuestos', 'Impuestos']]} />
            <div className="field"><label htmlFor="lDesde">Desde</label><input id="lDesde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div className="field"><label htmlFor="lHasta">Hasta</label><input id="lHasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            {libro === 'auxiliar' && <>
              <div className="field"><label htmlFor="lCuenta">Cuenta</label>
                <select id="lCuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                  {datos?.cuentas.filter((c) => c.codigo.length >= 4).map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                </select></div>
              <div className="field"><label htmlFor="lTercero">Tercero</label>
                <select id="lTercero" value={tercero} onChange={(e) => setTercero(e.target.value)}>
                  <option value="">Todos</option>
                  {datos?.terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select></div>
            </>}
            {libro === 'impuestos' && <label className="chip" style={{ cursor: 'pointer', alignSelf: 'end' }}>
              <input type="checkbox" checked={porTercero} onChange={(e) => setPorTercero(e.target.checked)} /> Resumen por tercero (certificados)</label>}
          </div>
        </div>
        <EncabezadoImpresion titulo={libro === 'diario' ? 'Libro diario' : libro === 'mayor' ? 'Libro mayor y balances' : libro === 'impuestos' ? 'Auxiliar de impuestos' : `Auxiliar de la cuenta ${cuenta}`} periodo={periodo} />

        {diario && (diario.asientos.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cuenta</th><th className="wrap">Detalle</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
            <tbody>
              {diario.asientos.map((a) => [
                <tr key={a.comprobanteId} className="fila-seccion"><td>{fechaCorta(a.fecha)}</td><td className="mono">{a.numero}</td><td colSpan={4} className="wrap">{a.concepto}</td></tr>,
                ...a.lineas.map((l, i) => (
                  <tr key={`${a.comprobanteId}-${i}`}><td></td><td></td><td className="mono">{l.cuenta}</td>
                    <td className="wrap">{l.nombreCuenta}{l.terceroId ? ` · ${datos!.nombresTercero.get(l.terceroId) ?? ''}` : ''}</td>
                    <td className="num mono">{l.debito ? dinero(l.debito) : ''}</td><td className="num mono">{l.credito ? dinero(l.credito) : ''}</td></tr>)),
              ])}
              <tr className="fila-total"><td colSpan={4}>Totales</td><td className="num mono">{dinero(diario.totalDebitos)}</td><td className="num mono">{dinero(diario.totalCreditos)}</td></tr>
            </tbody></table></div>
        ) : <Vacio icono="book">No hay comprobantes contabilizados en el período.</Vacio>)}

        {mayor && (mayor.filas.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Cuenta</th><th className="num">Saldo inicial</th><th className="num">Débitos</th><th className="num">Créditos</th><th className="num">Saldo final</th></tr></thead>
            <tbody>
              {mayor.filas.map((f) => (
                <tr key={f.codigo}><td className="mono">{f.codigo}</td><td className="wrap">{f.nombre}</td><td className="num mono">{conLado(f.saldoInicial)}</td>
                  <td className="num mono">{dinero(f.debitos)}</td><td className="num mono">{dinero(f.creditos)}</td><td className="num mono">{conLado(f.saldoFinal)}</td></tr>))}
              <tr className="fila-total"><td colSpan={3}>Totales</td><td className="num mono">{dinero(mayor.totalDebitos)}</td><td className="num mono">{dinero(mayor.totalCreditos)}</td>
                <td className="num"><span className={mayor.cuadra ? 'balance-ok' : 'balance-bad'}>{mayor.cuadra ? 'Cuadra' : 'Descuadrado'}</span></td></tr>
            </tbody></table></div>
        ) : <Vacio icono="book">No hay movimientos en el período.</Vacio>)}

        {imp && (imp.grupos.length ? <>
          <div className="panel-body">
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">IVA generado</span></div><div className="kpi-value">{dinero(imp.iva.generado)}</div></div>
              <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">IVA descontable</span></div><div className="kpi-value">{dinero(imp.iva.descontable)}</div></div>
              <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">{imp.iva.saldo >= 0n ? 'Saldo a pagar' : 'Saldo a favor'}</span></div><div className="kpi-value">{dinero(imp.iva.saldo < 0n ? -imp.iva.saldo : imp.iva.saldo)}</div></div>
            </div>
          </div>
          {imp.grupos.map((g) => (
            <div key={g.prefijo} className="table-wrap"><table>
              <thead>
                <tr className="fila-seccion"><td colSpan={porTercero ? 3 : 6}><b>{g.prefijo} · {g.nombre}</b></td><td className="num mono"><b>{dinero(g.valor)}</b></td></tr>
                {porTercero
                  ? <tr><th className="wrap">Tercero</th><th className="num">Base</th><th className="num">Valor</th></tr>
                  : <tr><th>Fecha</th><th>Comprobante</th><th className="wrap">Concepto</th><th className="wrap">Tercero</th><th className="num">Base</th><th className="num">Débito</th><th className="num">Crédito</th></tr>}
              </thead>
              {g.cuentas.map((c) => (
                <tbody key={c.cuenta}>
                  <tr className="fila-seccion"><td colSpan={porTercero ? 3 : 7}><span className="mono">{c.cuenta}</span> {c.nombre}</td></tr>
                  {porTercero
                    ? c.porTercero.map((t) => <tr key={t.terceroId ?? '-'}><td className="wrap">{nombreTercero(t.terceroId) || 'Sin tercero'}</td>
                        <td className="num mono">{dinero(t.base)}</td><td className="num mono">{dinero(t.valor)}</td></tr>)
                    : c.movimientos.map((m, i) => (
                      <tr key={i}><td>{fechaCorta(m.fecha)}</td><td className="mono">{m.numero}</td><td className="wrap">{m.nota ?? m.concepto}</td>
                        <td className="wrap">{nombreTercero(m.terceroId)}</td><td className="num mono">{m.base != null ? dinero(m.base) : ''}</td>
                        <td className="num mono">{m.debito ? dinero(m.debito) : ''}</td><td className="num mono">{m.credito ? dinero(m.credito) : ''}</td></tr>))}
                  <tr className="fila-total"><td colSpan={porTercero ? 1 : 4}>Total {c.cuenta}</td><td className="num mono">{dinero(c.base)}</td>
                    {porTercero ? <td className="num mono">{dinero(c.valor)}</td>
                      : <><td className="num mono">{dinero(c.debitos)}</td><td className="num mono">{dinero(c.creditos)}</td></>}</tr>
                </tbody>))}
            </table></div>))}
        </> : <Vacio icono="receipt">No hay movimientos de IVA ni de retenciones en el período.</Vacio>)}

        {aux && (
          <div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Comprobante</th><th className="wrap">Concepto</th><th className="wrap">Tercero</th><th className="num">Débito</th><th className="num">Crédito</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr className="fila-seccion"><td colSpan={6}>Saldo inicial</td><td className="num mono">{conLado(aux.saldoInicial)}</td></tr>
              {aux.filas.map((f, i) => (
                <tr key={i}><td>{fechaCorta(f.fecha)}</td><td className="mono">{f.numero}</td><td className="wrap">{f.concepto}</td>
                  <td className="wrap">{f.terceroId ? datos!.nombresTercero.get(f.terceroId) ?? '' : ''}</td>
                  <td className="num mono">{f.debito ? dinero(f.debito) : ''}</td><td className="num mono">{f.credito ? dinero(f.credito) : ''}</td><td className="num mono">{conLado(f.saldo)}</td></tr>))}
              <tr className="fila-total"><td colSpan={6}>Saldo final</td><td className="num mono">{conLado(aux.saldoFinal)}</td></tr>
            </tbody></table></div>
        )}
      </div>
    </>
  );
}
