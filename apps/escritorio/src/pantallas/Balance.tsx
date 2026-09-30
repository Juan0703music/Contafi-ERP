import { useState } from 'react';
import { balancePruebaLocal, hoyContable } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Vacio, dinero, haceCuanto } from '../componentes/comunes.tsx';

const conLado = (saldo: bigint) => (saldo === 0n ? dinero(0n) : `${dinero(saldo < 0n ? -saldo : saldo)} ${saldo > 0n ? 'Db' : 'Cr'}`);

export function Balance() {
  const { base, empresa, version } = useApp();
  const hoy = hoyContable().fecha;
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(hoy);
  const [nivel, setNivel] = useState(4);
  const [pendientes, setPendientes] = useState(true);
  const { datos: bp, error } = useDatos(
    () => balancePruebaLocal(base, empresa.id, { desde, hasta }, { incluirPendientes: pendientes, nivelMaximo: nivel }),
    [base, empresa.id, version, desde, hasta, nivel, pendientes],
  );

  return (
    <>
      <div className="page-head"><h1>Balance de prueba</h1><p>Saldo inicial, movimientos y saldo final por niveles del PUC.</p></div>
      <div className="panel">
        <div className="panel-body"><div className="grid4">
          <div className="field"><label htmlFor="bDesde">Desde</label><input id="bDesde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label htmlFor="bHasta">Hasta</label><input id="bHasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div className="field"><label htmlFor="bNivel">Nivel</label>
            <select id="bNivel" value={nivel} onChange={(e) => setNivel(Number(e.target.value))}>
              <option value={1}>Clase</option><option value={2}>Grupo</option><option value={3}>Cuenta</option><option value={4}>Subcuenta</option><option value={5}>Auxiliar</option>
            </select></div>
          <div className="field"><label htmlFor="bPend">Pendientes de sincronizar</label>
            <select id="bPend" value={pendientes ? 'si' : 'no'} onChange={(e) => setPendientes(e.target.value === 'si')}>
              <option value="si">Incluir (provisional)</option><option value="no">Excluir (solo oficial)</option>
            </select></div>
        </div>
        {bp?.provisional && <div className="notice warn" style={{ marginTop: 14, marginBottom: 0 }}>Balance <b>provisional</b>: incluye comprobantes sin número oficial. Saldos a la última sincronización ({haceCuanto(bp.ultimaSincronizacion)}).</div>}
        {error && <div className="notice danger" style={{ marginTop: 14, marginBottom: 0 }}>{error.message}</div>}
        </div>
        {bp && (bp.filas.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Cuenta</th><th className="num">Saldo inicial</th><th className="num">Débitos</th><th className="num">Créditos</th><th className="num">Saldo final</th></tr></thead>
            <tbody>
              {bp.filas.map((f) => (
                <tr key={f.codigo} style={{ fontWeight: f.nivel <= 2 ? 600 : 400 }}>
                  <td className="mono">{f.codigo}</td><td className="wrap" style={{ paddingLeft: 12 + (f.nivel - 1) * 14 }}>{f.nombre}</td>
                  <td className="num mono">{conLado(f.saldoInicial)}</td><td className="num mono">{dinero(f.debitos)}</td>
                  <td className="num mono">{dinero(f.creditos)}</td><td className="num mono">{conLado(f.saldoFinal)}</td>
                </tr>))}
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3}>Totales</td><td className="num mono">{dinero(bp.totalDebitos)}</td><td className="num mono">{dinero(bp.totalCreditos)}</td>
                <td className="num"><span className={bp.cuadra ? 'balance-ok' : 'balance-bad'}>{bp.cuadra ? 'Cuadra' : 'Descuadrado'}</span></td>
              </tr>
            </tbody></table></div>
        ) : <Vacio icono="scale">No hay movimientos en el rango.</Vacio>)}
      </div>
    </>
  );
}
