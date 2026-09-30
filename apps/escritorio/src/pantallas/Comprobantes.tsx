import { useEffect, useMemo, useRef, useState } from 'react';
import { leerMontoUsuario } from '@contafi/shared';
import { ErrorMotor, type Linea } from '@contafi/motor';
import {
  crearComprobante, cuentasLocales, descartarBorrador, guardarBorrador, hoyContable, leerBorrador, leerComprobantes,
  tercerosLocales, tiposComprobante, type ComprobanteLocal,
} from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, PillEstado, Vacio, dinero, fechaCorta, haceCuanto } from '../componentes/comunes.tsx';

export function Comprobantes({ nuevoComprobante }: { nuevoComprobante: () => void }) {
  const { base, empresa, version } = useApp();
  const { datos } = useDatos(() => leerComprobantes(base, empresa.id), [base, empresa.id, version]);
  const [viendo, setViendo] = useState<ComprobanteLocal | null>(null);
  const lista = useMemo(() => [...(datos ?? [])].reverse(), [datos]);

  return (
    <>
      <div className="page-head"><h1>Comprobantes contables</h1>
        <p>Todo movimiento pasa por el motor de partida doble. Lo creado sin conexión lleva un número local hasta que el servidor le asigna el oficial.</p></div>
      <div className="panel">
        <div className="panel-head"><h2>Todos los comprobantes</h2>
          <button className="btn primary sm" onClick={nuevoComprobante}><Icono nombre="plus" />Nuevo comprobante</button></div>
        {lista.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Número</th><th>Tipo</th><th>Fecha</th><th className="wrap">Concepto</th><th className="num">Valor</th><th>Estado</th><th></th></tr></thead>
            <tbody>{lista.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.numero ?? c.numeroLocal}</td>
                <td><span className={`vtag t-${c.tipo}`}>{c.tipo}</span></td>
                <td>{fechaCorta(c.fecha)}</td>
                <td className="wrap">{c.concepto}{c.reversaDe && <span className="hint"> · reverso</span>}</td>
                <td className="num mono">{dinero(c.lineas.reduce((s, l) => s + l.debito, 0n))}</td>
                <td><PillEstado estado={c.estado} /></td>
                <td className="btn-row"><button className="btn ghost sm" onClick={() => setViendo(c)}>Ver</button></td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="file">No hay comprobantes registrados.</Vacio>}
      </div>
      {viendo && <VerComprobante c={viendo} alCerrar={() => setViendo(null)} />}
    </>
  );
}

function VerComprobante({ c, alCerrar }: { c: ComprobanteLocal; alCerrar: () => void }) {
  const { base, empresa } = useApp();
  const { datos } = useDatos(async () => {
    const [cuentas, terceros] = await Promise.all([cuentasLocales(base, empresa.id), tercerosLocales(base, empresa.id)]);
    return { cuentas: new Map(cuentas.map((x) => [x.codigo, x.nombre])), terceros: new Map(terceros.map((t) => [t.id, t.nombre])) };
  }, [base, empresa.id]);
  return (
    <Modal titulo={`${c.numero ?? c.numeroLocal} — ${c.concepto}`} ancho alCerrar={alCerrar} pie={<button className="btn" onClick={alCerrar}>Cerrar</button>}>
      <p><PillEstado estado={c.estado} /> <span className="hint">{fechaCorta(c.fecha)}</span></p>
      {c.errores.length > 0 && (
        <div className="notice danger"><b>Rechazado por el servidor:</b><ul>{c.errores.map((e, i) => <li key={i}>{e.mensaje}</li>)}</ul></div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Cuenta</th><th className="wrap">Tercero</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
        <tbody>{c.lineas.map((l, i) => (
          <tr key={i}><td><span className="mono">{l.cuenta}</span> {datos?.cuentas.get(l.cuenta)}</td>
            <td className="wrap">{l.terceroId ? datos?.terceros.get(l.terceroId) ?? '—' : ''}</td>
            <td className="num mono">{l.debito ? dinero(l.debito) : ''}</td><td className="num mono">{l.credito ? dinero(l.credito) : ''}</td></tr>))}
        </tbody></table></div>
    </Modal>
  );
}

interface FilaForm { cuenta: string; tercero: string; nota: string; debito: string; credito: string }
interface Formulario { tipo: string; fecha: string; concepto: string; filas: FilaForm[] }

const filaVacia = (): FilaForm => ({ cuenta: '', tercero: '', nota: '', debito: '', credito: '' });
const AUTOGUARDADO_MS = 3000;

/** Formulario de comprobante manual con autoguardado cada 3 s (sección 9.5: sobrevive a un apagón). */
export function NuevoComprobante({ alCerrar }: { alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const clave = `form:comprobante:${empresa.id}`;
  const [form, setForm] = useState<Formulario>(() => ({ tipo: 'CG', fecha: hoyContable().fecha, concepto: '', filas: [filaVacia(), filaVacia()] }));
  const [recuperado, setRecuperado] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const sucio = useRef(false);

  const { datos: catalogos } = useDatos(async () => {
    const [cuentas, terceros, tipos, borrador] = await Promise.all([
      cuentasLocales(base, empresa.id), tercerosLocales(base, empresa.id), tiposComprobante(base, empresa.id), leerBorrador<Formulario>(base, clave),
    ]);
    if (borrador) { setForm(borrador.contenido); setRecuperado(borrador.actualizadoEn); }
    return { auxiliares: cuentas.filter((c) => c.aceptaMovimiento && c.activa), terceros, tipos, exige: new Map(cuentas.map((c) => [c.codigo, c.exigeTercero])) };
  }, [base, empresa.id]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!sucio.current) return;
      sucio.current = false;
      void guardarBorrador(base, clave, form, empresa.id);
    }, AUTOGUARDADO_MS);
    return () => clearInterval(t);
  }, [base, clave, form, empresa.id]);

  const cambiar = (f: (x: Formulario) => Formulario) => { sucio.current = true; setForm(f); };
  const cambiarFila = (i: number, campo: keyof FilaForm, valor: string) =>
    cambiar((x) => ({ ...x, filas: x.filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)) }));

  const montos = form.filas.map((f) => ({ d: leerMontoUsuario(f.debito || '0'), c: leerMontoUsuario(f.credito || '0') }));
  const totalD = montos.reduce((s, m) => s + (m.d ?? 0n), 0n);
  const totalC = montos.reduce((s, m) => s + (m.c ?? 0n), 0n);
  const cuadra = totalD === totalC && totalD > 0n;

  async function guardar() {
    const problemas: string[] = [];
    montos.forEach((m, i) => { if (m.d === null || m.c === null) problemas.push(`Línea ${i + 1}: el valor no es un monto válido.`); });
    const usadas = form.filas.filter((f) => f.cuenta || f.debito || f.credito);
    if (problemas.length) return setErrores(problemas);
    const lineas: Linea[] = usadas.map((f) => ({
      cuenta: f.cuenta, terceroId: f.tercero || null, nota: f.nota || null,
      debito: leerMontoUsuario(f.debito || '0')!, credito: leerMontoUsuario(f.credito || '0')!,
    }));
    setGuardando(true);
    try {
      const r = await crearComprobante(base, empresa.id, { tipo: form.tipo, fecha: form.fecha, concepto: form.concepto, lineas }, { claveBorrador: clave });
      avisar(`Comprobante ${r.numeroLocal} guardado. Recibirá su número oficial al sincronizar.`, 'ok');
      refrescar();
      alCerrar();
      void sincronizarAhora();
    } catch (e) {
      setErrores(e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje) : [(e as Error).message]);
    } finally {
      setGuardando(false);
    }
  }

  async function descartar() {
    await descartarBorrador(base, clave);
    alCerrar();
  }

  return (
    <Modal titulo="Nuevo comprobante contable" ancho="xl" alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={() => void descartar()}>Descartar</button>
      <button className="btn" onClick={() => { void guardarBorrador(base, clave, form, empresa.id); alCerrar(); }}>Seguir después</button>
      <button className="btn primary" disabled={guardando || !cuadra || !catalogos} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      {recuperado && <div className="notice info">Se recuperó lo que estaba escribiendo ({haceCuanto(recuperado)}).</div>}
      <div className="grid3">
        <div className="field"><label htmlFor="cTipo">Tipo</label>
          <select id="cTipo" value={form.tipo} onChange={(e) => cambiar((x) => ({ ...x, tipo: e.target.value }))}>
            {catalogos?.tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.nombre}</option>)}
          </select></div>
        <div className="field"><label htmlFor="cFecha">Fecha</label>
          <input id="cFecha" type="date" value={form.fecha} onChange={(e) => cambiar((x) => ({ ...x, fecha: e.target.value }))} /></div>
        <div className="field"><label htmlFor="cConcepto">Concepto</label>
          <input id="cConcepto" type="text" placeholder="Descripción del comprobante" value={form.concepto} onChange={(e) => cambiar((x) => ({ ...x, concepto: e.target.value }))} /></div>
      </div>
      <div className="field">
        <label>Movimientos</label>
        <div className="table-wrap entry-lines-table"><table>
          <thead><tr><th>Cuenta</th><th>Tercero</th><th>Nota</th><th>Débito</th><th>Crédito</th><th></th></tr></thead>
          <tbody>{form.filas.map((f, i) => {
            const exige = catalogos?.exige.get(f.cuenta);
            return (
              <tr key={i}>
                <td><select aria-label={`Cuenta línea ${i + 1}`} style={{ minWidth: 240 }} value={f.cuenta} onChange={(e) => cambiarFila(i, 'cuenta', e.target.value)}>
                  <option value="">Seleccione…</option>
                  {catalogos?.auxiliares.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                </select></td>
                <td><select aria-label={`Tercero línea ${i + 1}`} style={{ minWidth: 170, borderColor: exige && !f.tercero ? 'var(--warn-border)' : undefined }}
                  value={f.tercero} onChange={(e) => cambiarFila(i, 'tercero', e.target.value)}>
                  <option value="">{exige ? 'Obligatorio…' : '—'}</option>
                  {catalogos?.terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select></td>
                <td><input aria-label={`Nota línea ${i + 1}`} type="text" placeholder="Opcional" style={{ width: 120 }} value={f.nota} onChange={(e) => cambiarFila(i, 'nota', e.target.value)} /></td>
                <td><input type="text" aria-label={`Débito línea ${i + 1}`} className="mono" inputMode="decimal" placeholder="0" style={{ width: 130, textAlign: 'right' }} value={f.debito}
                  onChange={(e) => cambiarFila(i, 'debito', e.target.value)} /></td>
                <td><input type="text" aria-label={`Crédito línea ${i + 1}`} className="mono" inputMode="decimal" placeholder="0" style={{ width: 130, textAlign: 'right' }} value={f.credito}
                  onChange={(e) => cambiarFila(i, 'credito', e.target.value)} /></td>
                <td><button className="btn ghost sm" aria-label={`Quitar línea ${i + 1}`} disabled={form.filas.length <= 2}
                  onClick={() => cambiar((x) => ({ ...x, filas: x.filas.filter((_, j) => j !== i) }))}>✕</button></td>
              </tr>);
          })}</tbody></table></div>
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => cambiar((x) => ({ ...x, filas: [...x.filas, filaVacia()] }))}><Icono nombre="plus" />Agregar línea</button>
      </div>
      <div className="total-bar">
        <span>Σ Débitos: <b>{dinero(totalD)}</b></span><span>Σ Créditos: <b>{dinero(totalC)}</b></span>
        <span className={cuadra ? 'balance-ok' : 'balance-bad'}>{cuadra ? 'Balanceado' : totalD === totalC ? 'Sin valores' : `Diferencia ${dinero(totalD - totalC)}`}</span>
      </div>
      {errores.length > 0 && <div className="notice danger" role="alert" style={{ marginTop: 12 }}><b>No se pudo guardar:</b><ul>{errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </Modal>
  );
}
