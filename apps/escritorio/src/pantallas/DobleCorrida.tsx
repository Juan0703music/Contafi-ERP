import { useState } from 'react';
import { compararBalance } from '@contafi/motor';
import { comprobantesParaReportes, cuentasLocales, hoyContable, leerBalanceExterno, type ConvencionSaldo, type LecturaBalanceExterno } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Vacio, dinero, fechaCorta } from '../componentes/comunes.tsx';
import { BotonesReporte, EncabezadoImpresion, aPesos, exportarExcel } from '../componentes/reportes.tsx';

const conLado = (s: bigint) => (s === 0n ? dinero(0n) : `${dinero(s < 0n ? -s : s)} ${s > 0n ? 'Db' : 'Cr'}`);

/**
 * Doble corrida del piloto (Fase 6): el contador lleva la empresa en su software de siempre y en Contafi,
 * y compara los balances al cierre de cada mes. El criterio de salida es "cero diferencias" (sección 13).
 */
export function DobleCorrida() {
  const { base, empresa, version } = useApp();
  const hoy = hoyContable().fecha;
  const finMesAnterior = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const [corte, setCorte] = useState(finMesAnterior);
  const [convencion, setConvencion] = useState<ConvencionSaldo>('naturaleza');
  const [texto, setTexto] = useState<{ nombre: string; contenido: string } | null>(null);
  const [pendientes, setPendientes] = useState(false);
  const [todas, setTodas] = useState(false);

  const { datos } = useDatos(async () => ({
    cuentas: await cuentasLocales(base, empresa.id),
    comprobantes: await comprobantesParaReportes(base, empresa.id, { incluirPendientes: pendientes }),
  }), [base, empresa.id, version, pendientes]);

  const lectura: LecturaBalanceExterno | null = texto && datos
    ? leerBalanceExterno(texto.contenido, convencion, new Map(datos.cuentas.map((c) => [c.codigo, c.naturaleza])))
    : null;
  const r = lectura && datos && !lectura.errores.length ? compararBalance(datos.cuentas, datos.comprobantes, corte, lectura.filas) : null;
  const filas = r ? (todas ? r.filas : r.diferencias) : [];

  async function exportar() {
    if (!r) return;
    await exportarExcel(`doble-corrida-${empresa.nit}-${corte}`, 'Doble corrida', ['Cuenta', 'Nombre', 'Otro software', 'Contafi', 'Diferencia'], [
      ...r.filas.map((f) => [f.cuenta, f.nombre, aPesos(f.externo), aPesos(f.contafi), aPesos(f.diferencia)]),
      ...r.soloContafi.map((f) => [f.cuenta, `${f.nombre} (solo en Contafi)`, 0, aPesos(f.saldo), aPesos(f.saldo)]),
    ]);
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Doble corrida</h1><p>Compara el balance de Contafi con el del software anterior a la misma fecha de corte. La meta del piloto es cero diferencias.</p></div>
        {r && <BotonesReporte alExportar={exportar} />}
      </div>
      <div className="panel">
        <div className="panel-body no-imprimir">
          <ol className="hint" style={{ marginTop: 0 }}>
            <li>En el software anterior (Siigo, World Office, Helisa…), saca el balance de prueba a la fecha de corte, con todas las cuentas.</li>
            <li>Guárdalo como <b>CSV</b> desde Excel: código de la cuenta, nombre y saldo final (o saldo débito y saldo crédito).</li>
            <li>Cárgalo aquí. Las filas de títulos y totales se ignoran; se compara a cualquier nivel del PUC.</li>
          </ol>
          <div className="filtros-reporte">
            <div className="field"><label htmlFor="dCorte">Fecha de corte</label><input id="dCorte" type="date" value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
            <div className="field"><label htmlFor="dConv">El saldo del archivo viene</label>
              <select id="dConv" value={convencion} onChange={(e) => setConvencion(e.target.value as ConvencionSaldo)}>
                <option value="naturaleza">Según la naturaleza de la cuenta (positivo = saldo normal)</option>
                <option value="debito-credito">Como débito menos crédito (positivo = débito)</option>
              </select></div>
            <div className="field"><label htmlFor="dArchivo">Balance del otro software (CSV)</label>
              <input id="dArchivo" type="file" accept=".csv,.txt,text/csv" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then((contenido) => setTexto({ nombre: f.name, contenido }));
              }} /></div>
            <label className="chip" style={{ cursor: 'pointer', alignSelf: 'end' }}>
              <input type="checkbox" checked={pendientes} onChange={(e) => setPendientes(e.target.checked)} /> Incluir lo pendiente de sincronizar</label>
          </div>
          {lectura?.columnas === 'debito-credito' && <p className="hint" style={{ marginBottom: 0 }}>El archivo trae saldo débito y saldo crédito en columnas separadas: no hace falta elegir cómo viene el saldo.</p>}
          {lectura && lectura.errores.length > 0 && <div className="notice danger"><b>Corrija el archivo:</b><ul>{lectura.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        </div>
        <EncabezadoImpresion titulo={`Doble corrida contra ${texto?.nombre ?? 'el software anterior'}`} periodo={`Corte al ${fechaCorta(corte)}`} />
        {r ? (
          <>
            <div className="panel-body" style={{ paddingTop: 0 }}>
              <span className={r.sinDiferencias ? 'balance-ok' : 'balance-bad'}>
                {r.sinDiferencias ? `Cero diferencias en ${r.filas.length} cuentas comparadas` : `${r.diferencias.length + r.soloContafi.length} diferencia(s)`}</span>
              {' '}<label className="chip no-imprimir" style={{ cursor: 'pointer' }}><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Ver todas las cuentas comparadas</label>
            </div>
            {filas.length > 0 && (
              <div className="table-wrap"><table>
                <thead><tr><th>Cuenta</th><th className="wrap">Nombre</th><th className="num">Otro software</th><th className="num">Contafi</th><th className="num">Diferencia</th></tr></thead>
                <tbody>{filas.map((f) => (
                  <tr key={f.cuenta}><td className="mono">{f.cuenta}</td><td className="wrap">{f.nombre}</td>
                    <td className="num mono">{conLado(f.externo)}</td><td className="num mono">{conLado(f.contafi)}</td>
                    <td className="num mono">{f.diferencia === 0n ? '' : <b>{conLado(f.diferencia)}</b>}</td></tr>))}
                </tbody></table></div>)}
            {r.soloContafi.length > 0 && (
              <>
                <div className="panel-head"><h2>Solo en Contafi</h2><span className="hint">Cuentas con saldo que el otro software no tiene en ningún nivel</span></div>
                <div className="table-wrap"><table>
                  <thead><tr><th>Cuenta</th><th className="wrap">Nombre</th><th className="num">Saldo en Contafi</th></tr></thead>
                  <tbody>{r.soloContafi.map((f) => <tr key={f.cuenta}><td className="mono">{f.cuenta}</td><td className="wrap">{f.nombre}</td><td className="num mono">{conLado(f.saldo)}</td></tr>)}</tbody>
                </table></div>
              </>)}
          </>
        ) : !lectura && <Vacio icono="scale">Carga el balance del otro software para compararlo.</Vacio>}
      </div>
    </>
  );
}
