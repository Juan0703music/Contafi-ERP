import { useState } from 'react';
import { formatoTarifa } from '@contafi/shared';
import { crearProducto, cuentasLocales, existencias, kardexLocal, ErrorLocal, type DatosProducto, type Existencia } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio, dinero, fechaCorta } from '../componentes/comunes.tsx';
import { BotonesReporte, EncabezadoImpresion, aPesos, exportarExcel } from '../componentes/reportes.tsx';

const cantidad = (m: bigint) => (Number(m) / 1000).toLocaleString('es-CO', { maximumFractionDigits: 3 });

/** Inventario básico (sección 11.1): productos, existencias y kárdex por costo promedio. */
export function Inventario() {
  const { base, empresa, version } = useApp();
  const [nuevo, setNuevo] = useState(false);
  const [viendo, setViendo] = useState<Existencia | null>(null);
  const { datos } = useDatos(() => existencias(base, empresa.id), [base, empresa.id, version]);
  const total = (datos ?? []).reduce((s, e) => s + e.valor, 0n);

  async function exportar() {
    await exportarExcel(`inventario-${empresa.nit}`, 'Existencias', ['Código', 'Producto', 'Unidad', 'Cantidad', 'Costo promedio', 'Valor'],
      (datos ?? []).map((e) => [e.producto.codigo, e.producto.nombre, e.producto.unidad, Number(e.cantidad) / 1000, aPesos(e.costoPromedio), aPesos(e.valor)]));
  }

  return (
    <>
      <div className="page-head split">
        <div><h1>Inventario</h1><p>Existencias y kárdex por costo promedio, calculados desde las facturas contabilizadas.</p></div>
        <div className="btn-row"><BotonesReporte alExportar={exportar} /><button className="btn primary" onClick={() => setNuevo(true)}><Icono nombre="plus" />Nuevo producto</button></div>
      </div>
      <div className="panel">
        <EncabezadoImpresion titulo="Existencias de inventario" periodo="A la fecha" />
        {datos?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Producto</th><th>IVA</th><th className="num">Cantidad</th><th className="num">Costo promedio</th><th className="num">Valor</th><th></th></tr></thead>
            <tbody>
              {datos.map((e) => (
                <tr key={e.producto.id}>
                  <td className="mono">{e.producto.codigo}</td>
                  <td className="wrap">{e.producto.nombre}{e.producto.pendiente && <span className="pill draft" style={{ marginLeft: 6 }}>Sin sincronizar</span>}</td>
                  <td>{e.producto.iva.tipo === 'gravado' ? formatoTarifa(e.producto.iva.tarifa ?? 0n) : e.producto.iva.tipo}</td>
                  <td className="num mono" style={{ color: e.cantidad < 0n ? 'var(--danger)' : undefined }}>{cantidad(e.cantidad)} {e.producto.unidad}</td>
                  <td className="num mono">{dinero(e.costoPromedio)}</td>
                  <td className="num mono">{dinero(e.valor)}</td>
                  <td className="btn-row no-imprimir"><button className="btn ghost sm" onClick={() => setViendo(e)}>Kárdex</button></td>
                </tr>))}
              <tr className="fila-total"><td colSpan={5}>Valor total del inventario</td><td className="num mono">{dinero(total)}</td><td></td></tr>
            </tbody></table></div>
        ) : <Vacio icono="package">{datos ? 'Aún no hay productos. Créalos aquí y úsalos en las facturas de compra y venta.' : 'Cargando…'}</Vacio>}
      </div>
      {nuevo && <NuevoProducto alCerrar={() => setNuevo(false)} />}
      {viendo && <VerKardex e={viendo} alCerrar={() => setViendo(null)} />}
    </>
  );
}

function VerKardex({ e, alCerrar }: { e: Existencia; alCerrar: () => void }) {
  const { base, empresa } = useApp();
  const { datos } = useDatos(() => kardexLocal(base, empresa.id, e.producto.id), [base, empresa.id, e.producto.id]);
  return (
    <Modal titulo={`Kárdex · ${e.producto.codigo} ${e.producto.nombre}`} ancho="xl" alCerrar={alCerrar} pie={<button className="btn" onClick={alCerrar}>Cerrar</button>}>
      {datos?.movimientos.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Comprobante</th><th className="wrap">Concepto</th><th>Movimiento</th><th className="num">Cantidad</th><th className="num">Valor</th><th className="num">Saldo</th><th className="num">Valor del saldo</th><th className="num">Costo promedio</th></tr></thead>
          <tbody>{datos.movimientos.map((m, i) => (
            <tr key={i}>
              <td>{fechaCorta(m.fecha)}</td><td className="mono">{m.numero ?? '—'}</td><td className="wrap">{m.concepto}</td>
              <td>{m.tipo === 'entrada' ? <span className="pill posted">Entrada</span> : <span className="pill open">Salida</span>}</td>
              <td className="num mono">{cantidad(m.cantidad)}</td><td className="num mono">{dinero(m.valor)}</td>
              <td className="num mono">{cantidad(m.saldoCantidad)}</td><td className="num mono">{dinero(m.saldoValor)}</td><td className="num mono">{dinero(m.costoPromedio)}</td>
            </tr>))}</tbody></table></div>
      ) : <Vacio icono="package">Este producto aún no tiene movimientos.</Vacio>}
    </Modal>
  );
}

function NuevoProducto({ alCerrar }: { alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [d, setD] = useState<DatosProducto>({ codigo: '', nombre: '', tipo: 'producto', unidad: 'UND', iva: '19', precioVenta: '', cuentaInventario: '143505' });
  const [error, setError] = useState<string | null>(null);
  const { datos: cuentas } = useDatos(async () => (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && c.codigo.startsWith('14')), [base, empresa.id]);
  const campo = <K extends keyof DatosProducto>(k: K, v: DatosProducto[K]) => setD((x) => ({ ...x, [k]: v }));

  async function guardar() {
    try {
      await crearProducto(base, empresa.id, d);
      avisar('Producto creado.', 'ok');
      refrescar();
      void sincronizarAhora();
      alCerrar();
    } catch (e) { setError(e instanceof ErrorLocal ? e.message : (e as Error).message); }
  }

  return (
    <Modal titulo="Nuevo producto" alCerrar={alCerrar} pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      <div className="grid2">
        <div className="field"><label htmlFor="pCod">Código</label><input id="pCod" type="text" className="mono" value={d.codigo} onChange={(e) => campo('codigo', e.target.value)} /></div>
        <div className="field"><label htmlFor="pTipo">Tipo</label>
          <select id="pTipo" value={d.tipo} onChange={(e) => campo('tipo', e.target.value as DatosProducto['tipo'])}>
            <option value="producto">Producto (lleva kárdex)</option><option value="servicio">Servicio</option>
          </select></div>
      </div>
      <div className="field"><label htmlFor="pNom">Nombre</label><input id="pNom" type="text" value={d.nombre} onChange={(e) => campo('nombre', e.target.value)} /></div>
      <div className="grid3">
        <div className="field"><label htmlFor="pUni">Unidad</label><input id="pUni" type="text" value={d.unidad} onChange={(e) => campo('unidad', e.target.value)} /></div>
        <div className="field"><label htmlFor="pIva">IVA</label>
          <select id="pIva" value={d.iva} onChange={(e) => campo('iva', e.target.value)}>
            <option value="19">19 %</option><option value="5">5 %</option><option value="exento">Exento</option><option value="excluido">Excluido</option>
          </select></div>
        <div className="field"><label htmlFor="pPre">Precio de venta</label><input id="pPre" type="text" className="mono" inputMode="decimal" value={d.precioVenta} onChange={(e) => campo('precioVenta', e.target.value)} /></div>
      </div>
      {d.tipo === 'producto' && (
        <div className="field"><label htmlFor="pCta">Cuenta de inventario</label>
          <select id="pCta" value={d.cuentaInventario} onChange={(e) => campo('cuentaInventario', e.target.value)}>
            {cuentas?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
          </select></div>)}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
