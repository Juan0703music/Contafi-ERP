import { useEffect, useRef, useState } from 'react';
import { cargarDatos, calcularAlertas, resumenAlertas, type MensajeLLM, type RespuestaJarvis } from '@contafi/jarvis';
import { useApp, useDatos, type Ruta } from '../estado.tsx';
import { Icono } from '../componentes/comunes.tsx';
import { estadoIA, instalarIA, prepararJarvis, preguntarJarvis, type EstadoIA } from '../datos/ia.ts';
import { enTauri } from '../datos/base-tauri.ts';

interface Mensaje { quien: 'user' | 'bot'; texto: string; respuesta?: RespuestaJarvis }

const SUGERENCIAS = [
  '¿Cuánta plata tenemos en bancos?', '¿Cuánto nos deben los clientes?', '¿Cuánto IVA hay que pagar este bimestre?',
  '¿Cuál es la utilidad del año?', '¿En qué estamos gastando más?', '¿Qué alertas hay?',
];

/**
 * Jarvis (sección 12): responde preguntas en español con datos del motor. Con IA si el PC la tiene;
 * si no, con el asistente por reglas. Toda cifra viene del motor y se verifica.
 */
export function Jarvis() {
  const { base, empresa, version, ir, usuario } = useApp();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [pensando, setPensando] = useState(false);
  const [ia, setIa] = useState<EstadoIA | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const ctx = { base, empresa };

  const { datos: alertas } = useDatos(async () => calcularAlertas(await cargarDatos(ctx)), [base, empresa.id, version]);
  useEffect(() => { void estadoIA().then((e) => { setIa(e); prepararJarvis(e); }); }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [mensajes, pensando]);

  async function enviar(texto: string) {
    const q = texto.trim();
    if (!q || pensando || !ia) return;
    setPregunta('');
    setMensajes((m) => [...m, { quien: 'user', texto: q }]);
    setPensando(true);
    const historial: MensajeLLM[] = mensajes.slice(-6).map((m) => ({ role: m.quien === 'user' ? 'user' : 'assistant', content: m.texto }));
    const r = await preguntarJarvis(q, ctx, ia, historial);
    setMensajes((m) => [...m, { quien: 'bot', texto: r.texto, respuesta: r }]);
    setPensando(false);
  }

  const modo = !ia ? 'Revisando…' : ia.externa ? 'IA local (servidor de desarrollo)'
    : ia.disponible && ia.motorInstalado && ia.modelosDescargados.length ? `IA local · ${ia.modelosDescargados[0]}`
      : 'Asistente por reglas (sin IA)';

  return (
    <>
      <div className="page-head split">
        <div><h1>Jarvis</h1><p>Pregunta en español sobre {empresa.razon_social}. Las cifras salen del motor contable y no salen de este equipo.</p></div>
        <span className="chip"><span className={`pill ${modo.startsWith('IA') ? 'posted' : 'open'}`}>{modo}</span></span>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="panel" style={{ margin: 0 }}>
          <div className="chat-box">
            <div className="chat-log" ref={log} style={{ maxHeight: 520, minHeight: 320 }}>
              {alertas && <div className="msg bot">{resumenAlertas(alertas, usuario.nombre.split(' ')[0])}</div>}
              {mensajes.map((m, i) => (
                <div key={i} className={`msg ${m.quien}`}>
                  {m.texto}
                  {m.respuesta && <PieRespuesta r={m.respuesta} />}
                </div>
              ))}
              {pensando && <div className="msg bot"><span className="hint">Consultando los libros…</span></div>}
            </div>
            <div className="suggest-row">{SUGERENCIAS.map((s) => <button key={s} type="button" className="suggest-chip" onClick={() => void enviar(s)}>{s}</button>)}</div>
            <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void enviar(pregunta); }}>
              <input type="text" aria-label="Pregunta para Jarvis" placeholder="Escribe tu pregunta…" value={pregunta} onChange={(e) => setPregunta(e.target.value)} />
              <button type="submit" className="btn primary" disabled={pensando || !pregunta.trim()}>Preguntar</button>
            </form>
          </div>
        </div>
        <div>
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-head"><h2>Alertas</h2><span className="hint">Calculadas por reglas</span></div>
            <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
              {alertas?.length ? alertas.map((a) => (
                <button key={a.id} type="button" className="alert-row" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => ir(a.ruta as Ruta)}>
                  <span className={`alert-ic${a.nivel === 'alta' ? ' danger' : ''}`}><Icono nombre={a.nivel === 'info' ? 'info' : 'alert'} /></span>
                  <span><b>{a.titulo}</b><br /><span className="hint">{a.detalle}</span></span>
                </button>
              )) : <span className="hint">{alertas ? 'Sin alertas: todo al día.' : 'Calculando…'}</span>}
            </div>
          </div>
          {ia && <PanelIA estado={ia} alCambiar={() => void estadoIA().then(setIa)} />}
        </div>
      </div>
    </>
  );
}

function PieRespuesta({ r }: { r: RespuestaJarvis }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 }}>
      {r.cifrasNoVerificadas.length
        ? <span className="pill annulled" title="Esta cifra no salió de los datos: no la use sin revisarla">Cifra no verificada: {r.cifrasNoVerificadas.join(', ')}</span>
        : r.herramientas.length ? <span className="pill posted">Cifras del motor</span> : null}
      {r.provisional && <span className="pill draft">A la última sincronización</span>}
      <span className="hint">{r.motor === 'ia' ? 'IA local' : 'Reglas'} · {(r.milisegundos / 1000).toFixed(1)} s</span>
      {r.herramientas.length > 0 && <button type="button" className="btn ghost sm" onClick={() => setVer(!ver)}>{ver ? 'Ocultar datos' : 'Ver datos'}</button>}
      {ver && <pre className="mono" style={{ width: '100%', whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0 0', maxHeight: 220, overflow: 'auto' }}>
        {r.herramientas.map((h) => `${h.nombre}(${JSON.stringify(h.argumentos)})\n${JSON.stringify(h.resultado, null, 2)}`).join('\n\n')}
      </pre>}
    </div>
  );
}

function PanelIA({ estado, alCambiar }: { estado: EstadoIA; alCambiar: () => void }) {
  const { avisar } = useApp();
  const [progreso, setProgreso] = useState<{ texto: string; porcentaje: number } | null>(null);
  const instalado = estado.motorInstalado && estado.modelosDescargados.length > 0;

  async function instalar() {
    if (!estado.recomendado) return;
    try {
      await instalarIA(estado.recomendado, (texto, porcentaje) => setProgreso({ texto, porcentaje }));
      avisar('IA local instalada y verificada.', 'ok');
      alCambiar();
    } catch (e) {
      avisar(`No se pudo instalar: ${(e as Error).message}`, 'danger');
    } finally {
      setProgreso(null);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h2>IA en este equipo</h2></div>
      <div className="panel-body">
        {!enTauri() && !estado.externa && <p className="hint" style={{ margin: 0 }}>En el navegador Jarvis usa el asistente por reglas. La IA local se instala en la app de escritorio.</p>}
        {estado.externa && <p className="hint" style={{ margin: 0 }}>Conectado a un servidor de IA de desarrollo: {estado.externa}</p>}
        {enTauri() && <>
          <p style={{ marginTop: 0 }}>Memoria del PC: <b>{estado.ramGB ?? '?'} GB</b>.{' '}
            {estado.recomendado ? <>Modelo recomendado: <b>{estado.recomendado.nombre}</b> ({(estado.recomendado.tamanoMB / 1024).toFixed(1)} GB, licencia {estado.recomendado.licencia}).</>
              : <>Con menos de 8 GB, Jarvis funciona con el asistente por reglas.</>}</p>
          {instalado ? <span className="pill posted">Instalada: {estado.modelosDescargados.join(', ')}</span>
            : estado.recomendado && (progreso
              ? <div><b>{progreso.texto}</b>: {progreso.porcentaje} %<div style={{ height: 6, borderRadius: 3, background: 'var(--well)', marginTop: 6 }}><div style={{ width: `${progreso.porcentaje}%`, height: 6, borderRadius: 3, background: 'var(--accent)' }} /></div></div>
              : <button className="btn primary" onClick={() => void instalar()}>Descargar IA ({((estado.recomendado.tamanoMB + 19) / 1024).toFixed(1)} GB)</button>)}
          <p className="hint" style={{ marginBottom: 0 }}>Se descarga una sola vez, se verifica con su huella SHA-256 y funciona sin internet. Nada sale del PC.</p>
        </>}
      </div>
    </div>
  );
}
