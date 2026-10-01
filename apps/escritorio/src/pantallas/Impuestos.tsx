import { useState } from 'react';
import { formatoTarifa } from '@contafi/shared';
import { conceptosRetencion, cuentasLocales, uvtsConfiguradas, ErrorLocal, type DatosConcepto } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio, dinero } from '../componentes/comunes.tsx';

const TIPOS = { RETEFUENTE: 'Retención en la fuente', RETEIVA: 'ReteIVA', RETEICA: 'ReteICA' } as const;

/**
 * Parámetros tributarios de la empresa. Regla de oro del plan: nada de esto viene escrito en el código.
 * El contador los define con la norma vigente (UVT del año, tarifas, bases y cuentas).
 */
export function Impuestos() {
  const { base, empresa, version, refrescar, avisar, impuestos, sincronizarAhora } = useApp();
  const [editando, setEditando] = useState<DatosConcepto | null>(null);
  const [anioUvt, setAnioUvt] = useState(String(new Date().getFullYear()));
  const [valorUvt, setValorUvt] = useState('');
  const { datos } = useDatos(async () => ({
    uvts: await uvtsConfiguradas(base),
    conceptos: await conceptosRetencion(base, empresa.id),
    cuentas: (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && (c.codigo.startsWith('23') || c.codigo.startsWith('13'))),
  }), [base, empresa.id, version]);

  async function guardarLaUvt() {
    try {
      await impuestos.guardarUvt(empresa.id, Number(anioUvt), valorUvt);
      if (impuestos.compartida) await sincronizarAhora();
      avisar(`UVT de ${anioUvt} guardada${impuestos.compartida ? ' para todas las empresas de la firma' : ''}.`, 'ok');
      setValorUvt('');
      refrescar();
    } catch (e) { avisar((e as Error).message, 'danger'); }
  }

  return (
    <>
      <div className="page-head"><h1>Impuestos y retenciones</h1>
        <p>Contafi no trae tarifas escritas: configúralas con la norma vigente. Se usan al importar facturas de la DIAN y al facturar.
          {impuestos.compartida && ' Se guardan en la nube (requiere conexión) y las usan todos los equipos de la firma.'}</p></div>
      <div className="panel">
        <div className="panel-head"><h2>Valor de la UVT por año</h2><span className="hint">Resolución anual de la DIAN</span></div>
        <div className="panel-body">
          <div className="filtros-reporte">
            <div className="field"><label htmlFor="uAnio">Año</label><input id="uAnio" type="number" min={2000} max={2100} value={anioUvt} onChange={(e) => setAnioUvt(e.target.value)} /></div>
            <div className="field"><label htmlFor="uValor">Valor en pesos</label><input type="text" id="uValor" className="mono" inputMode="decimal" placeholder="Según la resolución" value={valorUvt} onChange={(e) => setValorUvt(e.target.value)} /></div>
            <button className="btn primary" disabled={!valorUvt} onClick={() => void guardarLaUvt()}>Guardar UVT</button>
          </div>
          {datos?.uvts.length ? <p className="hint" style={{ marginBottom: 0 }}>{datos.uvts.map((u) => `${u.anio}: ${dinero(u.uvt)}`).join(' · ')}</p>
            : <div className="notice warn" style={{ marginTop: 12, marginBottom: 0 }}>Sin UVT configurada no se pueden verificar las bases mínimas de retención.</div>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Conceptos de retención</h2>
          <button className="btn primary sm" onClick={() => setEditando({ codigo: '', tipo: 'RETEFUENTE', nombre: '', tarifa: '', baseMinimaUvt: '0', cuenta: '', aplicaEn: 'compras' })}>
            <Icono nombre="plus" />Nuevo concepto</button></div>
        {datos?.conceptos.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Nombre</th><th>Tipo</th><th className="num">Tarifa</th><th className="num">Base mínima</th><th>Cuenta</th><th>Se aplica en</th><th></th></tr></thead>
            <tbody>{datos.conceptos.map((c) => (
              <tr key={c.codigo} style={{ opacity: c.activo ? 1 : 0.5 }}>
                <td className="mono">{c.codigo}</td><td className="wrap">{c.nombre}</td><td>{TIPOS[c.tipo]}</td>
                <td className="num mono">{formatoTarifa(c.tarifa)}</td><td className="num mono">{c.baseMinimaUvt} UVT</td><td className="mono">{c.cuenta}</td>
                <td>{c.aplicaEn === 'compras' ? 'Compras (la practicamos)' : 'Ventas (nos la practican)'}</td>
                <td className="btn-row">
                  <button className="btn ghost sm" onClick={() => setEditando({ codigo: c.codigo, tipo: c.tipo, nombre: c.nombre, tarifa: formatoTarifa(c.tarifa).replace(' %', ''), baseMinimaUvt: c.baseMinimaUvt, cuenta: c.cuenta, aplicaEn: c.aplicaEn })}>Editar</button>
                  {c.activo && <button className="btn ghost sm" onClick={() => void impuestos.desactivarConcepto(empresa.id, c.codigo)
                    .then(async () => { if (impuestos.compartida) await sincronizarAhora(); refrescar(); }, (e: Error) => avisar(e.message, 'danger'))}>Desactivar</button>}
                </td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="sliders">Aún no hay conceptos. Crea los que usa esta empresa (por ejemplo, retención en la fuente por compras o servicios, reteIVA y reteICA del municipio).</Vacio>}
      </div>
      {editando && datos && <EditarConcepto inicial={editando} cuentas={datos.cuentas} alCerrar={() => setEditando(null)} />}
    </>
  );
}

function EditarConcepto({ inicial, cuentas, alCerrar }: { inicial: DatosConcepto; cuentas: { codigo: string; nombre: string }[]; alCerrar: () => void }) {
  const { empresa, refrescar, avisar, impuestos, sincronizarAhora } = useApp();
  const [d, setD] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const campo = <K extends keyof DatosConcepto>(k: K, v: DatosConcepto[K]) => setD((x) => ({ ...x, [k]: v }));
  const cuentasFiltradas = cuentas.filter((c) => c.codigo.startsWith(d.aplicaEn === 'compras' ? '23' : '13'));

  async function guardar() {
    try {
      await impuestos.guardarConcepto(empresa.id, d);
      if (impuestos.compartida) await sincronizarAhora();
      avisar('Concepto guardado.', 'ok');
      refrescar();
      alCerrar();
    } catch (e) { setError(e instanceof ErrorLocal ? e.message : (e as Error).message); }
  }

  return (
    <Modal titulo={inicial.codigo ? `Concepto ${inicial.codigo}` : 'Nuevo concepto de retención'} alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      <div className="grid2">
        <div className="field"><label htmlFor="rCod">Código</label><input type="text" id="rCod" className="mono" value={d.codigo} disabled={!!inicial.codigo} placeholder="RF-COMPRAS" onChange={(e) => campo('codigo', e.target.value)} /></div>
        <div className="field"><label htmlFor="rTipo">Tipo</label>
          <select id="rTipo" value={d.tipo} onChange={(e) => campo('tipo', e.target.value as DatosConcepto['tipo'])}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      <div className="field"><label htmlFor="rNom">Nombre</label><input type="text" id="rNom" value={d.nombre} placeholder="Retención en la fuente por compras" onChange={(e) => campo('nombre', e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="rTar">Tarifa (%)</label><input type="text" id="rTar" className="mono" inputMode="decimal" value={d.tarifa} placeholder="p. ej. 2,5" onChange={(e) => campo('tarifa', e.target.value)} /></div>
        <div className="field"><label htmlFor="rBase">Base mínima (UVT)</label><input type="text" id="rBase" className="mono" inputMode="decimal" value={d.baseMinimaUvt} onChange={(e) => campo('baseMinimaUvt', e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="rApl">Se aplica en</label>
          <select id="rApl" value={d.aplicaEn} onChange={(e) => setD((x) => ({ ...x, aplicaEn: e.target.value as DatosConcepto['aplicaEn'], cuenta: '' }))}>
            <option value="compras">Compras (la practicamos)</option><option value="ventas">Ventas (nos la practican)</option>
          </select></div>
        <div className="field"><label htmlFor="rCta">Cuenta</label>
          <select id="rCta" value={d.cuenta} onChange={(e) => campo('cuenta', e.target.value)}>
            <option value="">Seleccione…</option>
            {cuentasFiltradas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
          </select></div>
      </div>
      {d.tipo === 'RETEIVA' && <p className="hint">La reteIVA se calcula sobre el IVA del documento, no sobre el subtotal.</p>}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
