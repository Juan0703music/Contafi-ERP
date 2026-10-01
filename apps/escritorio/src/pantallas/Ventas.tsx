import { useEffect, useState } from 'react';
import { formatoTarifa, leerMontoUsuario } from '@contafi/shared';
import { ErrorMotor, type ItemDocumento, type TotalesDocumento } from '@contafi/motor';
import {
  antiguedadLocal, calcularFactura, conceptosRetencion, crearFactura, cuentasLocales, hoyContable, registrarMovimientoTercero,
  tercerosLocales, ErrorLocal, type FilaAntiguedad,
} from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio, dinero } from '../componentes/comunes.tsx';
import { BotonesReporte, EncabezadoImpresion, Pestanas, aPesos, exportarExcel } from '../componentes/reportes.tsx';

type Vista = 'cartera' | 'por_pagar';

export function Ventas() {
  const { base, empresa, version } = useApp();
  const [vista, setVista] = useState<Vista>('cartera');
  const [factura, setFactura] = useState<'venta' | 'compra' | null>(null);
  const [movimiento, setMovimiento] = useState<FilaAntiguedad | null>(null);
  const corte = hoyContable().fecha;
  const { datos } = useDatos(() => antiguedadLocal(base, empresa.id, vista, corte), [base, empresa.id, version, vista, corte]);
  const filas = (datos ?? []).filter((f) => f.saldo !== 0n);
  const total = (k: keyof FilaAntiguedad['rangos']) => filas.reduce((s, f) => s + (f.saldo > 0n ? f.rangos[k] : 0n), 0n);

  async function exportar() {
    await exportarExcel(`${vista}-${empresa.nit}-${corte}`, vista === 'cartera' ? 'Cartera' : 'Por pagar',
      ['Tercero', 'Saldo', '0-30 días', '31-60', '61-90', 'Más de 90'],
      filas.map((f) => [f.nombre, aPesos(f.saldo), aPesos(f.rangos.r0_30), aPesos(f.rangos.r31_60), aPesos(f.rangos.r61_90), aPesos(f.rangos.mas90)]));
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Ventas y compras</h1><p>Facturas registradas a mano, cartera y cuentas por pagar por edades, recaudos y pagos.</p></div>
        <div className="btn-row">
          <button className="btn" onClick={() => setFactura('compra')}><Icono nombre="cart" />Factura de compra</button>
          <button className="btn primary" onClick={() => setFactura('venta')}><Icono nombre="plus" />Factura de venta</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head no-imprimir">
          <Pestanas etiqueta="Vista" valor={vista} cambiar={setVista} opciones={[['cartera', 'Cartera (nos deben)'], ['por_pagar', 'Por pagar (debemos)']]} />
          <BotonesReporte alExportar={exportar} />
        </div>
        <EncabezadoImpresion titulo={vista === 'cartera' ? 'Cartera por edades' : 'Cuentas por pagar por edades'} periodo={`A ${corte}`} />
        {filas.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th className="wrap">Tercero</th><th className="num">Saldo</th><th className="num">0–30 días</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">Más de 90</th><th></th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.terceroId}>
                  <td className="wrap">{f.nombre}{f.saldo < 0n && <span className="hint"> · anticipo</span>}</td>
                  <td className="num mono"><b>{dinero(f.saldo)}</b></td>
                  <td className="num mono">{f.rangos.r0_30 ? dinero(f.rangos.r0_30) : ''}</td>
                  <td className="num mono">{f.rangos.r31_60 ? dinero(f.rangos.r31_60) : ''}</td>
                  <td className="num mono">{f.rangos.r61_90 ? dinero(f.rangos.r61_90) : ''}</td>
                  <td className="num mono" style={{ color: f.rangos.mas90 ? 'var(--danger)' : undefined }}>{f.rangos.mas90 ? dinero(f.rangos.mas90) : ''}</td>
                  <td className="btn-row no-imprimir">{f.saldo > 0n && <button className="btn ghost sm" onClick={() => setMovimiento(f)}>{vista === 'cartera' ? 'Recaudo' : 'Pago'}</button>}</td>
                </tr>))}
              <tr className="fila-total"><td>Total</td><td className="num mono">{dinero(filas.reduce((s, f) => s + f.saldo, 0n))}</td>
                <td className="num mono">{dinero(total('r0_30'))}</td><td className="num mono">{dinero(total('r31_60'))}</td>
                <td className="num mono">{dinero(total('r61_90'))}</td><td className="num mono">{dinero(total('mas90'))}</td><td></td></tr>
            </tbody></table></div>
        ) : <Vacio icono={vista === 'cartera' ? 'arrowDownLeft' : 'arrowUpRight'}>{datos ? 'No hay saldos pendientes.' : 'Calculando…'}</Vacio>}
        <p className="hint" style={{ padding: '0 20px 14px', margin: 0 }}>Sin fechas de vencimiento por factura, la edad se cuenta desde la fecha de cada documento y los abonos cancelan primero lo más antiguo.</p>
      </div>
      {factura && <NuevaFactura sentido={factura} alCerrar={() => setFactura(null)} />}
      {movimiento && <NuevoMovimiento tipo={vista === 'cartera' ? 'recaudo' : 'pago'} fila={movimiento} alCerrar={() => setMovimiento(null)} />}
    </>
  );
}

interface FilaItem { descripcion: string; cuenta: string; cantidad: string; valor: string; iva: string }
const IVAS: [string, string][] = [['190000', 'IVA 19 %'], ['50000', 'IVA 5 %'], ['exento', 'Exento'], ['excluido', 'Excluido']];

function aItems(filas: FilaItem[]): ItemDocumento[] | null {
  const items: ItemDocumento[] = [];
  for (const f of filas) {
    if (!f.descripcion && !f.valor) continue;
    const valor = leerMontoUsuario(f.valor);
    if (valor === null || !/^\d+([.,]\d{1,3})?$/.test(f.cantidad.trim())) return null;
    items.push({
      descripcion: f.descripcion || 'Ítem', cantidad: f.cantidad.trim(), valorUnitario: valor, cuenta: f.cuenta,
      iva: f.iva === 'exento' || f.iva === 'excluido' ? { tipo: f.iva } : { tipo: 'gravado', tarifa: BigInt(f.iva) },
    });
  }
  return items;
}

function NuevaFactura({ sentido, alCerrar }: { sentido: 'venta' | 'compra'; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const cuentaPorDefecto = sentido === 'venta' ? '413595' : '519595';
  const [tercero, setTercero] = useState('');
  const [fecha, setFecha] = useState(hoyContable().fecha);
  const [numero, setNumero] = useState('');
  const [filas, setFilas] = useState<FilaItem[]>([{ descripcion: '', cuenta: cuentaPorDefecto, cantidad: '1', valor: '', iva: '190000' }]);
  const [retenciones, setRetenciones] = useState<string[]>([]);
  const [ivaDescontable, setIvaDescontable] = useState(true);
  const [totales, setTotales] = useState<TotalesDocumento | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { datos } = useDatos(async () => ({
    terceros: (await tercerosLocales(base, empresa.id)).filter((t) => t.activo),
    cuentas: (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && c.activa && /^[14567]/.test(c.codigo)),
    conceptos: (await conceptosRetencion(base, empresa.id, true)).filter((c) => c.aplicaEn === (sentido === 'venta' ? 'ventas' : 'compras')),
  }), [base, empresa.id]);

  const items = aItems(filas);
  const clave = JSON.stringify([filas, retenciones, fecha]);
  useEffect(() => {
    if (!items?.length) { setTotales(null); return; }
    let vivo = true;
    calcularFactura(base, empresa.id, { sentido, terceroId: tercero, fecha, numero, items, retenciones })
      .then((t) => { if (vivo) { setTotales(t); setError(null); } })
      .catch((e: Error) => { if (vivo) { setTotales(null); setError(e.message); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const cambiar = (i: number, k: keyof FilaItem, v: string) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function guardar() {
    if (!tercero) return setError('Elija el tercero.');
    if (!items?.length) return setError('Revise los ítems: cantidades y valores.');
    try {
      const r = await crearFactura(base, empresa.id, { sentido, terceroId: tercero, fecha, numero, items, retenciones, ivaDescontable });
      avisar(`Factura ${numero} guardada como ${r.numeroLocal}.`, 'ok');
      refrescar();
      void sincronizarAhora();
      alCerrar();
    } catch (e) {
      setError(e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje).join(' ') : e instanceof ErrorLocal ? e.message : (e as Error).message);
    }
  }

  return (
    <Modal titulo={sentido === 'venta' ? 'Nueva factura de venta' : 'Nueva factura de compra'} ancho="xl" alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" disabled={!totales || !tercero} onClick={() => void guardar()}>Guardar</button></>}>
      <div className="grid3">
        <div className="field"><label htmlFor="fTer">{sentido === 'venta' ? 'Cliente' : 'Proveedor'}</label>
          <select id="fTer" value={tercero} onChange={(e) => setTercero(e.target.value)}>
            <option value="">Seleccione…</option>
            {datos?.terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select></div>
        <div className="field"><label htmlFor="fNum">Número de factura</label><input id="fNum" type="text" className="mono" value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
        <div className="field"><label htmlFor="fFecha">Fecha</label><input id="fFecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="table-wrap entry-lines-table"><table>
        <thead><tr><th>Descripción</th><th>Cuenta</th><th>Cantidad</th><th>Valor unitario</th><th>IVA</th><th></th></tr></thead>
        <tbody>{filas.map((f, i) => (
          <tr key={i}>
            <td><input type="text" aria-label={`Descripción ítem ${i + 1}`} style={{ width: 200 }} value={f.descripcion} onChange={(e) => cambiar(i, 'descripcion', e.target.value)} /></td>
            <td><select aria-label={`Cuenta ítem ${i + 1}`} style={{ width: 220 }} value={f.cuenta} onChange={(e) => cambiar(i, 'cuenta', e.target.value)}>
              {datos?.cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
            </select></td>
            <td><input type="text" aria-label={`Cantidad ítem ${i + 1}`} className="mono" style={{ width: 80, textAlign: 'right' }} value={f.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} /></td>
            <td><input type="text" aria-label={`Valor ítem ${i + 1}`} className="mono" inputMode="decimal" style={{ width: 130, textAlign: 'right' }} value={f.valor} onChange={(e) => cambiar(i, 'valor', e.target.value)} /></td>
            <td><select aria-label={`IVA ítem ${i + 1}`} value={f.iva} onChange={(e) => cambiar(i, 'iva', e.target.value)}>{IVAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
            <td><button className="btn ghost sm" aria-label={`Quitar ítem ${i + 1}`} disabled={filas.length <= 1} onClick={() => setFilas((xs) => xs.filter((_, j) => j !== i))}>✕</button></td>
          </tr>))}</tbody></table></div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setFilas((xs) => [...xs, { descripcion: '', cuenta: cuentaPorDefecto, cantidad: '1', valor: '', iva: '190000' }])}><Icono nombre="plus" />Agregar ítem</button>
      <div className="filtros-reporte" style={{ marginTop: 12 }}>
        {(datos?.conceptos.length ?? 0) > 0 ? datos!.conceptos.map((c) => (
          <label key={c.codigo} className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={retenciones.includes(c.codigo)} onChange={(e) => setRetenciones((r) => (e.target.checked ? [...r, c.codigo] : r.filter((x) => x !== c.codigo)))} />
            {' '}{c.nombre} ({formatoTarifa(c.tarifa)})
          </label>)) : <span className="hint">Sin conceptos de retención configurados para {sentido === 'venta' ? 'ventas' : 'compras'}.</span>}
        {sentido === 'compra' && <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={ivaDescontable} onChange={(e) => setIvaDescontable(e.target.checked)} /> IVA descontable</label>}
      </div>
      {totales && (
        <div className="total-bar" style={{ marginTop: 12 }}>
          <span>Subtotal: <b>{dinero(totales.subtotal)}</b></span><span>IVA: <b>{dinero(totales.totalIva)}</b></span>
          <span>Total: <b>{dinero(totales.total)}</b></span>
          {totales.totalRetenciones > 0n && <span>Retenciones: <b>{dinero(totales.totalRetenciones)}</b></span>}
          <span>{sentido === 'venta' ? 'Por cobrar' : 'Por pagar'}: <b>{dinero(totales.neto)}</b></span>
        </div>)}
      {error && <div className="notice danger" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function NuevoMovimiento({ tipo, fila, alCerrar }: { tipo: 'recaudo' | 'pago'; fila: FilaAntiguedad; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [valor, setValor] = useState(dinero(fila.saldo).replace('$ ', ''));
  const [fecha, setFecha] = useState(hoyContable().fecha);
  const [cuenta, setCuenta] = useState('111005');
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { datos: cajas } = useDatos(async () => (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && c.codigo.startsWith('11')), [base, empresa.id]);

  async function guardar() {
    const v = leerMontoUsuario(valor);
    if (v === null) return setError('Valor inválido.');
    try {
      const r = await registrarMovimientoTercero(base, empresa.id, { tipo, terceroId: fila.terceroId, fecha, valor: v, cuentaBanco: cuenta, referencia });
      avisar(`${tipo === 'recaudo' ? 'Recaudo' : 'Pago'} ${r.numeroLocal} registrado.`, 'ok');
      refrescar();
      void sincronizarAhora();
      alCerrar();
    } catch (e) {
      setError(e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje).join(' ') : (e as Error).message);
    }
  }

  return (
    <Modal titulo={`${tipo === 'recaudo' ? 'Recaudo de' : 'Pago a'} ${fila.nombre}`} alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Registrar</button></>}>
      <p className="hint" style={{ marginTop: 0 }}>Saldo pendiente: <b className="mono">{dinero(fila.saldo)}</b></p>
      <div className="grid2">
        <div className="field"><label htmlFor="mValor">Valor</label><input id="mValor" type="text" className="mono" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
        <div className="field"><label htmlFor="mFecha">Fecha</label><input id="mFecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="mCuenta">{tipo === 'recaudo' ? 'Entra a' : 'Sale de'}</label>
          <select id="mCuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>{cajas?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}</select></div>
        <div className="field"><label htmlFor="mRef">Referencia (opcional)</label><input id="mRef" type="text" value={referencia} placeholder="Transferencia, cheque…" onChange={(e) => setReferencia(e.target.value)} /></div>
      </div>
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
