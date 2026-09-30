import { useState } from 'react';
import { estadoResultadosDetallado, estadoSituacionFinanciera, type SeccionEstado } from '@contafi/motor';
import { comprobantesParaReportes, cuentasLocales, hoyContable } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { dinero, fechaCorta, haceCuanto } from '../componentes/comunes.tsx';
import { BotonesReporte, EncabezadoImpresion, Pestanas, aPesos, exportarExcel, type CeldaExcel } from '../componentes/reportes.tsx';

type Estado = 'situacion' | 'resultados';

function FilasSeccion({ s }: { s: SeccionEstado }) {
  return (
    <>
      <tr className="fila-seccion"><td colSpan={3}>{s.titulo}</td></tr>
      {s.renglones.map((r) => (
        <tr key={`${s.titulo}-${r.codigo}-${r.nombre}`}><td className="mono">{r.codigo}</td><td className="wrap">{r.nombre}</td><td className="num mono">{dinero(r.valor)}</td></tr>))}
      <tr><td></td><td><b>Total {s.titulo.toLowerCase()}</b></td><td className="num mono"><b>{dinero(s.total)}</b></td></tr>
    </>
  );
}

const Total = ({ texto, valor }: { texto: string; valor: bigint }) => (
  <tr className="fila-total"><td></td><td>{texto}</td><td className="num mono">{dinero(valor)}</td></tr>
);

export function Estados() {
  const { base, empresa, version, sync } = useApp();
  const hoy = hoyContable().fecha;
  const [estado, setEstado] = useState<Estado>('situacion');
  const [corte, setCorte] = useState(hoy);
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`);
  const [pendientes, setPendientes] = useState(false);

  const { datos } = useDatos(async () => {
    const [cuentas, comprobantes] = await Promise.all([cuentasLocales(base, empresa.id), comprobantesParaReportes(base, empresa.id, { incluirPendientes: pendientes })]);
    return { cuentas, comprobantes };
  }, [base, empresa.id, version, pendientes]);

  const esf = datos && estado === 'situacion' ? estadoSituacionFinanciera(datos.cuentas, datos.comprobantes, corte) : null;
  const er = datos && estado === 'resultados' ? estadoResultadosDetallado(datos.cuentas, datos.comprobantes, { desde, hasta: corte }) : null;
  const periodo = esf ? `A ${fechaCorta(corte)}` : `Del ${fechaCorta(desde)} al ${fechaCorta(corte)}`;
  const provisional = pendientes && (sync.estado?.pendientes ?? 0) > 0;

  async function exportar() {
    const filas: CeldaExcel[][] = [];
    const agregar = (s: SeccionEstado) => {
      filas.push([null, s.titulo, null]);
      for (const r of s.renglones) filas.push([r.codigo, r.nombre, aPesos(r.valor)]);
      filas.push([null, `Total ${s.titulo.toLowerCase()}`, aPesos(s.total)]);
    };
    if (esf) {
      [esf.activoCorriente, esf.activoNoCorriente].forEach(agregar);
      filas.push([null, 'TOTAL ACTIVO', aPesos(esf.totalActivo)]);
      [esf.pasivoCorriente, esf.pasivoNoCorriente].forEach(agregar);
      filas.push([null, 'TOTAL PASIVO', aPesos(esf.totalPasivo)]);
      agregar(esf.patrimonio);
      filas.push([null, 'TOTAL PASIVO Y PATRIMONIO', aPesos(esf.totalPasivoYPatrimonio)]);
    } else if (er) {
      er.secciones.forEach(agregar);
      filas.push([null, 'UTILIDAD NETA', aPesos(er.utilidadNeta)]);
    }
    await exportarExcel(`${estado}-${empresa.nit}-${corte}`, esf ? 'Situación financiera' : 'Resultados', ['Código', 'Concepto', 'Valor'], filas);
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Estados financieros</h1><p>Presentación por grupos y cuentas del PUC. La clasificación corriente/no corriente debe validarla el contador.</p></div>
        <BotonesReporte alExportar={exportar} />
      </div>
      {provisional && <div className="notice warn">Estados <b>provisionales</b>: incluyen comprobantes sin número oficial (última sincronización {haceCuanto(sync.estado?.ultimaSincronizacion ?? null)}).</div>}
      <div className="panel">
        <div className="panel-body no-imprimir">
          <div className="filtros-reporte">
            <Pestanas etiqueta="Estado" valor={estado} cambiar={setEstado} opciones={[['situacion', 'Situación financiera'], ['resultados', 'Resultados']]} />
            {estado === 'resultados' && <div className="field"><label htmlFor="eDesde">Desde</label><input id="eDesde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>}
            <div className="field"><label htmlFor="eCorte">{estado === 'situacion' ? 'Fecha de corte' : 'Hasta'}</label><input id="eCorte" type="date" value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
            <div className="field"><label htmlFor="ePend">Pendientes de sincronizar</label>
              <select id="ePend" value={pendientes ? 'si' : 'no'} onChange={(e) => setPendientes(e.target.value === 'si')}>
                <option value="no">Excluir (solo oficial)</option><option value="si">Incluir (provisional)</option>
              </select></div>
          </div>
        </div>
        <EncabezadoImpresion titulo={esf ? 'Estado de situación financiera' : 'Estado de resultados'} periodo={periodo + (provisional ? ' (provisional)' : '')} />
        <div className="table-wrap"><table>
          <thead><tr><th>Código</th><th className="wrap">Concepto</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {esf && <>
              <FilasSeccion s={esf.activoCorriente} /><FilasSeccion s={esf.activoNoCorriente} />
              <Total texto="TOTAL ACTIVO" valor={esf.totalActivo} />
              <FilasSeccion s={esf.pasivoCorriente} /><FilasSeccion s={esf.pasivoNoCorriente} />
              <Total texto="TOTAL PASIVO" valor={esf.totalPasivo} />
              <FilasSeccion s={esf.patrimonio} />
              <Total texto="TOTAL PASIVO Y PATRIMONIO" valor={esf.totalPasivoYPatrimonio} />
              <tr><td></td><td colSpan={2}><span className={esf.cuadra ? 'balance-ok' : 'balance-bad'}>{esf.cuadra ? 'Activo = Pasivo + Patrimonio' : 'La ecuación no cuadra'}</span></td></tr>
            </>}
            {er && <>
              <FilasSeccion s={er.secciones[0]!} /><FilasSeccion s={er.secciones[1]!} />
              <Total texto="UTILIDAD BRUTA" valor={er.utilidadBruta} />
              <FilasSeccion s={er.secciones[2]!} /><FilasSeccion s={er.secciones[3]!} />
              <Total texto="UTILIDAD OPERACIONAL" valor={er.utilidadOperacional} />
              <FilasSeccion s={er.secciones[4]!} /><FilasSeccion s={er.secciones[5]!} />
              <Total texto="UTILIDAD ANTES DE IMPUESTOS" valor={er.utilidadAntesDeImpuestos} />
              <FilasSeccion s={er.secciones[6]!} />
              <Total texto={er.utilidadNeta < 0n ? 'PÉRDIDA NETA' : 'UTILIDAD NETA'} valor={er.utilidadNeta} />
            </>}
          </tbody></table></div>
      </div>
    </>
  );
}
