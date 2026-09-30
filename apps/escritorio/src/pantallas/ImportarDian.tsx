import { useRef, useState } from 'react';
import {
  contabilizarImportacion, cuentasLocales, prepararImportacion, type ItemImportacion,
} from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Vacio, dinero, fechaCorta } from '../componentes/comunes.tsx';

const ESTADOS: Record<ItemImportacion['estado'], [string, string]> = {
  nuevo: ['open', 'Nuevo'], duplicado: ['closed', 'Ya importado'], ajeno: ['annulled', 'De otra empresa'], error: ['annulled', 'Error'],
};

/**
 * Importación de facturas electrónicas (la función estrella del MVP, sección 11.1): el contador suelta los
 * XML o ZIP que llegan por correo, revisa el asiento propuesto de cada uno y los contabiliza en lote.
 */
export function ImportarDian() {
  const { base, empresa, version, avisar, refrescar, sincronizarAhora, ir } = useApp();
  const [items, setItems] = useState<ItemImportacion[]>([]);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [cuentas, setCuentas] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const { datos: auxiliares } = useDatos(async () => (await cuentasLocales(base, empresa.id)).filter((c) => c.aceptaMovimiento && c.activa), [base, empresa.id, version]);

  async function leer(archivos: FileList | File[]) {
    setOcupado(true);
    try {
      const entradas = await Promise.all([...archivos].map(async (f) => ({ nombre: f.name, contenido: new Uint8Array(await f.arrayBuffer()) })));
      const nuevos = await prepararImportacion(base, empresa, entradas, { anio: new Date().getFullYear(), uvt: 0n });
      setItems(nuevos);
      setElegidos(new Set(nuevos.map((x, i) => (x.estado === 'nuevo' ? i : -1)).filter((i) => i >= 0)));
      setCuentas({});
    } catch (e) {
      avisar(`No se pudieron leer los archivos: ${(e as Error).message}`, 'danger');
    } finally {
      setOcupado(false);
    }
  }

  async function contabilizar() {
    setOcupado(true);
    try {
      const seleccion = [...elegidos].map((i) => ({ item: items[i]!, cuenta: cuentas[i] }));
      const r = await contabilizarImportacion(base, empresa, seleccion);
      if (r.contabilizados.length) avisar(`${r.contabilizados.length} documento(s) contabilizados${r.tercerosCreados ? `, ${r.tercerosCreados} tercero(s) creados` : ''}.`, 'ok');
      if (r.fallidos.length) avisar(`${r.fallidos.length} no se pudieron contabilizar: ${r.fallidos.map((f) => `${f.numero}: ${f.mensaje}`).join(' · ')}`, 'danger');
      setItems([]);
      setElegidos(new Set());
      refrescar();
      void sincronizarAhora();
      if (!r.fallidos.length) ir('comprobantes');
    } finally {
      setOcupado(false);
    }
  }

  const alternar = (i: number) => setElegidos((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const nuevos = items.filter((x) => x.estado === 'nuevo').length;

  return (
    <>
      <div className="page-head split">
        <div><h1>Importar facturas DIAN</h1><p>Suelta los XML o ZIP de facturas electrónicas recibidas o emitidas. Contafi propone el asiento; tú lo revisas.</p></div>
        {items.length > 0 && (
          <div className="btn-row">
            <button className="btn" onClick={() => { setItems([]); setElegidos(new Set()); }}>Limpiar</button>
            <button className="btn primary" disabled={ocupado || elegidos.size === 0} onClick={() => void contabilizar()}>
              <Icono nombre="check" />{ocupado ? 'Contabilizando…' : `Contabilizar ${elegidos.size} seleccionado(s)`}
            </button>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-body">
          <div className={`zona-archivos${arrastrando ? ' activa' : ''}`} role="button" tabIndex={0}
            onClick={() => entrada.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') entrada.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); void leer(e.dataTransfer.files); }}>
            <Icono nombre="receipt" />
            <b>{ocupado ? 'Leyendo…' : 'Arrastra aquí los archivos o haz clic para elegirlos'}</b>
            <span className="hint">XML (AttachedDocument o factura UBL 2.1) y ZIP como llegan por correo. Los PDF se ignoran.</span>
            <input ref={entrada} type="file" multiple accept=".xml,.zip" hidden aria-label="Archivos de la DIAN"
              onChange={(e) => { if (e.target.files?.length) void leer(e.target.files); e.target.value = ''; }} />
          </div>
        </div>
        {items.length > 0 ? (
          <div className="table-wrap"><table>
            <thead><tr><th></th><th>Documento</th><th>Fecha</th><th className="wrap">Tercero</th><th className="num">Total</th><th>Cuenta</th><th>Estado</th></tr></thead>
            <tbody>{items.map((x, i) => {
              const p = x.propuesta;
              const d = x.documento;
              const [clase, texto] = ESTADOS[x.estado];
              return (
                <tr key={i}>
                  <td><input type="checkbox" aria-label={`Seleccionar ${d?.numero ?? x.archivo}`} disabled={x.estado !== 'nuevo'} checked={elegidos.has(i)} onChange={() => alternar(i)} /></td>
                  <td>
                    <span className="mono">{d?.numero ?? '—'}</span>{p && <span className="hint"> · {p.tipoComprobante} {p.sentido}</span>}
                    <div className="hint" title={x.archivo} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.archivo}</div>
                  </td>
                  <td>{d ? fechaCorta(d.fechaEmision) : ''}</td>
                  <td className="wrap">
                    {p ? <>{p.tercero.razonSocial} <span className="hint mono">{p.tercero.nit}</span>{!x.terceroId && <> <span className="pill draft">Se creará</span></>}</> : x.mensaje}
                    {p && p.advertencias.length > 0 && <ul className="advertencias">{p.advertencias.map((a, j) => <li key={j}>{a}</li>)}</ul>}
                  </td>
                  <td className="num mono">{d ? dinero(d.totalAPagar) : ''}</td>
                  <td>{p && x.estado === 'nuevo' ? (
                    <select aria-label={`Cuenta de ${d?.numero}`} style={{ minWidth: 200 }} value={cuentas[i] ?? p.cuentaSugerida.cuenta}
                      onChange={(e) => setCuentas((c) => ({ ...c, [i]: e.target.value }))}>
                      {auxiliares?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                    </select>) : null}
                    {p && x.estado === 'nuevo' && p.cuentaSugerida.origen === 'regla' && cuentas[i] === undefined && <div className="hint">Cuenta aprendida del proveedor</div>}
                  </td>
                  <td><span className={`pill ${clase}`} title={x.mensaje ?? ''}>{texto}</span></td>
                </tr>);
            })}</tbody></table></div>
        ) : <Vacio icono="receipt">Todavía no has cargado archivos. {nuevos === 0 && 'Las facturas ya importadas se detectan por su CUFE y no se duplican.'}</Vacio>}
      </div>
    </>
  );
}
