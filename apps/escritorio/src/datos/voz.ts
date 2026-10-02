import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DetectorVoz, PISTA_VOCABULARIO, a16k, codificarWav, textoParaVoz, type EstadoDetector } from '@contafi/jarvis';
import { enTauri } from './base-tauri.ts';

/**
 * Voz de Jarvis, 100 % local (como la IA, sección 12):
 *  · Oír: whisper.cpp (whisper-server) en 127.0.0.1, con un modelo que se descarga y verifica una vez.
 *  · Hablar: la voz del sistema operativo. Solo voces LOCALES: las "en línea" mandarían a internet el texto
 *    de la respuesta, que trae cifras de la empresa.
 */
export const CATALOGO_VOZ = {
  motor: {
    archivo: 'whisper-bin-x64.zip', licencia: 'MIT', tamanoMB: 8,
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
    sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
  },
  // "small" multilingüe cuantizado: con la pista de vocabulario entiende bien el español contable (~3 s por pregunta en un i5).
  modelo: {
    archivo: 'ggml-small-q5_1.bin', licencia: 'MIT', tamanoMB: 182,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
} as const;

/**
 * Voces neuronales locales (Piper): suenan como una persona y funcionan sin internet. Piper es MIT; para
 * pronunciar usa espeak-ng (GPL-3.0), que va dentro de su paquete y corre como programa aparte.
 */
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es';
export const CATALOGO_LECTURA = {
  motor: {
    archivo: 'piper_windows_amd64.zip', licencia: 'MIT', tamanoMB: 21,
    url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
    sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  },
  voces: [
    {
      id: 'es_MX-claude-high', nombre: 'Claude', descripcion: 'mujer, México, calidad alta', licencia: 'Apache 2.0', tamanoMB: 60,
      onnx: { url: `${HF}/es_MX/claude/high/es_MX-claude-high.onnx`, sha256: '3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0' },
      json: { url: `${HF}/es_MX/claude/high/es_MX-claude-high.onnx.json`, sha256: '1afc81f703c0e4cb3b4d7c0dca096b8b54a98806807f0170cf5eb5557723c12d' },
    },
    {
      id: 'es_MX-ald-medium', nombre: 'Ald', descripcion: 'hombre, México', licencia: 'dominio público (Unlicense)', tamanoMB: 60,
      onnx: { url: `${HF}/es_MX/ald/medium/es_MX-ald-medium.onnx`, sha256: '019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63' },
      json: { url: `${HF}/es_MX/ald/medium/es_MX-ald-medium.onnx.json`, sha256: '5a71498158e04afc8099bfd019c7e87c68eb9d042505a2b1a87e5c1ac2b1a61d' },
    },
    {
      id: 'es_AR-daniela-high', nombre: 'Daniela', descripcion: 'mujer, Argentina, calidad alta', licencia: 'CC BY-SA 4.0 (OpenSLR 61)', tamanoMB: 109,
      onnx: { url: `${HF}/es_AR/daniela/high/es_AR-daniela-high.onnx`, sha256: '7ceb1fc0dab349418c5b54a639ae9ee595212d7c9ea422220d8419163d5cc985' },
      json: { url: `${HF}/es_AR/daniela/high/es_AR-daniela-high.onnx.json`, sha256: 'aedbf69647e1d754c62ecf8e0366ca5f16af3e768e3c6b5329af6eb6bde3852b' },
    },
  ],
} as const;
export type VozLectura = (typeof CATALOGO_LECTURA.voces)[number];

/** Desarrollo en el navegador: VITE_WHISPER_URL apunta a un whisper-server ya corriendo. */
const URL_EXTERNA = import.meta.env.VITE_WHISPER_URL as string | undefined;
/** Desarrollo en el navegador: VITE_PIPER_URL apunta a scripts/voz-desarrollo.mjs. */
const URL_LECTURA = import.meta.env.VITE_PIPER_URL as string | undefined;

const PREFERENCIA_VOZ = 'contafi:jarvis-voz';
/** Voz elegida: id del catálogo o 'sistema'. Por defecto, Claude. */
export function vozElegida(): string {
  try { return localStorage.getItem(PREFERENCIA_VOZ) ?? CATALOGO_LECTURA.voces[0].id; } catch { return CATALOGO_LECTURA.voces[0].id; }
}
export function elegirVoz(id: string): void {
  try { localStorage.setItem(PREFERENCIA_VOZ, id); } catch { /* sin almacenamiento */ }
}

export interface EstadoVoz {
  /** Se puede hablarle a Jarvis (hay reconocimiento local instalado o un servidor de desarrollo). */
  reconocimiento: boolean;
  /** En la app de escritorio: falta descargar el reconocimiento. */
  instalable: boolean;
  externa: string | null;
  /** Nombre de la voz local en español del sistema (respaldo; null = no hay). */
  vozLectura: string | null;
  /** Voces neuronales (Piper) listas para usar en este equipo. */
  vocesNeuronales: string[];
  /** En la app de escritorio: las voces neuronales se pueden descargar. */
  lecturaInstalable: boolean;
}

/** Las voces del sistema cargan después de abrir la página. */
function voces(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const ya = speechSynthesis.getVoices();
  if (ya.length) return Promise.resolve(ya);
  return new Promise((r) => {
    const t = setTimeout(() => r(speechSynthesis.getVoices()), 1500);
    speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); r(speechSynthesis.getVoices()); }, { once: true });
  });
}

/**
 * Voces que no salen a internet. WebView2 (Windows) y Chrome marcan bien `localService`; Firefox en Linux
 * marca como no locales las de speech-dispatcher, que sí lo son. Por eso también se acepta una voz cuyo
 * nombre no indica un servicio en línea ("Online", "Natural", "Google"…).
 */
const EN_LINEA = /online|natural|neural|google|cloud|azure|amazon|polly/i;
const esLocal = (v: SpeechSynthesisVoice) => v.localService || !EN_LINEA.test(v.name);

async function vozLocalEspanol(): Promise<SpeechSynthesisVoice | null> {
  const candidatas = (await voces()).filter((v) => v.lang.toLowerCase().startsWith('es') && esLocal(v))
    .sort((a, b) => Number(b.localService) - Number(a.localService));
  for (const p of ['es-co', 'es-419', 'es-mx', 'es-us', 'es-es', 'es']) {
    const v = candidatas.find((x) => x.lang.toLowerCase().replace('_', '-').startsWith(p));
    if (v) return v;
  }
  return null;
}

export async function estadoVoz(): Promise<EstadoVoz> {
  const voz = await vozLocalEspanol();
  const vozLectura = voz ? voz.name : null;
  const todas = CATALOGO_LECTURA.voces.map((v) => v.id);
  if (!enTauri()) {
    return {
      reconocimiento: !!URL_EXTERNA, instalable: false, externa: URL_EXTERNA ?? null, vozLectura,
      vocesNeuronales: URL_LECTURA ? todas : [], lecturaInstalable: false,
    };
  }
  const a = await invoke<{ archivos: string[]; voz_instalada: boolean; lector_instalado: boolean }>('ia_archivos');
  const instalada = a.voz_instalada && a.archivos.includes(CATALOGO_VOZ.modelo.archivo);
  const neuronales = a.lector_instalado ? todas.filter((id) => a.archivos.includes(`${id}.onnx`) && a.archivos.includes(`${id}.onnx.json`)) : [];
  return {
    reconocimiento: !!URL_EXTERNA || instalada, instalable: !URL_EXTERNA && !instalada, externa: URL_EXTERNA ?? null, vozLectura,
    vocesNeuronales: neuronales, lecturaInstalable: true,
  };
}

/** Descarga Piper (a su propia carpeta) y una voz; verifica todo con SHA-256. */
export async function instalarLectura(voz: VozLectura, progreso: (texto: string, porcentaje: number) => void): Promise<void> {
  const { motor } = CATALOGO_LECTURA;
  const quitar = await listen<{ archivo: string; descargado: number; total: number }>('ia-descarga', ({ payload: p }) => {
    progreso(p.archivo === motor.archivo ? 'Motor de voz' : `Voz ${voz.nombre}`, p.total ? Math.floor((p.descargado / p.total) * 100) : 0);
  });
  try {
    await invoke('ia_descargar', { url: motor.url, archivo: motor.archivo, sha256: motor.sha256, extraer: true, carpeta: 'piper' });
    await invoke('ia_descargar', { url: voz.json.url, archivo: `${voz.id}.onnx.json`, sha256: voz.json.sha256, extraer: false });
    await invoke('ia_descargar', { url: voz.onnx.url, archivo: `${voz.id}.onnx`, sha256: voz.onnx.sha256, extraer: false });
  } finally {
    quitar();
  }
}

/** Descarga whisper.cpp (a su propia carpeta) y el modelo de voz; verifica ambos con SHA-256. */
export async function instalarVoz(progreso: (texto: string, porcentaje: number) => void): Promise<void> {
  const { motor, modelo } = CATALOGO_VOZ;
  const quitar = await listen<{ archivo: string; descargado: number; total: number }>('ia-descarga', ({ payload: p }) => {
    progreso(p.archivo === modelo.archivo ? 'Modelo de voz' : 'Reconocimiento de voz', p.total ? Math.floor((p.descargado / p.total) * 100) : 0);
  });
  try {
    await invoke('ia_descargar', { url: motor.url, archivo: motor.archivo, sha256: motor.sha256, extraer: true, carpeta: 'voz' });
    await invoke('ia_descargar', { url: modelo.url, archivo: modelo.archivo, sha256: modelo.sha256, extraer: false });
  } finally {
    quitar();
  }
}

// ------------------------------------------------------------------ reconocimiento

let servidor: string | null = null;
let apagado: ReturnType<typeof setTimeout> | undefined;

async function urlReconocimiento(): Promise<string> {
  if (URL_EXTERNA) return URL_EXTERNA;
  if (!servidor) {
    const s = await invoke<{ url: string }>('voz_iniciar', { modelo: CATALOGO_VOZ.modelo.archivo, pista: PISTA_VOCABULARIO });
    // Escucha cuando el modelo ya está cargado: basta con que responda algo.
    for (let i = 0; i < 120; i++) {
      try { await fetch(s.url, { method: 'GET' }); servidor = s.url; break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!servidor) { await invoke('voz_detener'); throw new Error('El reconocimiento de voz no arrancó.'); }
  }
  // Se apaga tras 5 minutos sin usarse, para liberar memoria.
  clearTimeout(apagado);
  apagado = setTimeout(() => { servidor = null; void invoke('voz_detener'); }, 5 * 60_000);
  return servidor;
}

/** Texto de una grabación (WAV de 16 kHz). Con URL externa, la pista de vocabulario va en la petición. */
export async function transcribir(wav: Uint8Array<ArrayBuffer>): Promise<string> {
  const url = await urlReconocimiento();
  const datos = new FormData();
  datos.append('file', new Blob([wav], { type: 'audio/wav' }), 'pregunta.wav');
  datos.append('response_format', 'json');
  datos.append('temperature', '0');
  datos.append('language', 'es');
  if (URL_EXTERNA) datos.append('prompt', PISTA_VOCABULARIO);
  const r = await fetch(`${url}/inference`, { method: 'POST', body: datos, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`El reconocimiento de voz respondió ${r.status}.`);
  const j = await r.json() as { text?: string; error?: string };
  if (j.error) throw new Error(j.error);
  // whisper marca el ruido o la música entre corchetes o paréntesis: no es una pregunta.
  return (j.text ?? '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Graba una pregunta: empieza cuando la persona habla y termina tras un silencio (o al detenerla).
 * Devuelve el WAV de 16 kHz, o null si nadie habló.
 */
export async function escuchar(o: { alCambiar?: (e: EstadoDetector) => void; senal?: AbortSignal } = {}): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este equipo no permite usar el micrófono.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw new Error('No hay permiso para usar el micrófono (o no hay micrófono conectado).');
  }
  const ctx = new AudioContext();
  const fuente = ctx.createMediaStreamSource(stream);
  // ScriptProcessor está en desuso, pero funciona igual en WebView2 (Windows), Firefox y Chrome sin archivos aparte.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const trozos: Float32Array[] = [];
  const detector = new DetectorVoz();
  return new Promise((resolver) => {
    let listo = false;
    const terminar = (conAudio: boolean) => {
      if (listo) return;
      listo = true;
      proc.disconnect();
      fuente.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const tasa = ctx.sampleRate;
      void ctx.close();
      if (!conAudio) return resolver(null);
      const todo = new Float32Array(trozos.reduce((n, t) => n + t.length, 0));
      let pos = 0;
      for (const t of trozos) { todo.set(t, pos); pos += t.length; }
      resolver(codificarWav(a16k(todo, tasa)));
    };
    proc.onaudioprocess = (e) => {
      const bloque = new Float32Array(e.inputBuffer.getChannelData(0));
      trozos.push(bloque);
      const estado = detector.procesar(bloque, (bloque.length / ctx.sampleRate) * 1000);
      o.alCambiar?.(estado);
      if (estado === 'fin') terminar(true);
      else if (estado === 'sin-voz') terminar(false);
    };
    fuente.connect(proc);
    proc.connect(ctx.destination);
    // Detener a mano: si ya estaba hablando, se usa lo grabado.
    o.senal?.addEventListener('abort', () => terminar(detector.estado === 'hablando'), { once: true });
  });
}

// ------------------------------------------------------------------ lectura en voz alta

let audio: HTMLAudioElement | null = null;
let urlAudio: string | null = null;
/** Cada lectura tiene su turno: si se pide callar (o otra lectura) mientras se genera, no suena. */
let turno = 0;

function soltarAudio() {
  audio?.pause();
  audio = null;
  if (urlAudio) URL.revokeObjectURL(urlAudio);
  urlAudio = null;
}

/** WAV de la respuesta con una voz neuronal local (Piper). */
async function sintetizar(texto: string, voz: string): Promise<ArrayBuffer> {
  if (URL_LECTURA) {
    const r = await fetch(`${URL_LECTURA}/leer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contenido: texto, voz: `${voz}.onnx` }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.arrayBuffer();
  }
  return invoke<ArrayBuffer>('voz_sintetizar', { contenido: texto, voz: `${voz}.onnx` });
}

/**
 * Lee la respuesta: con la voz neuronal elegida si está disponible (suena como una persona) y, si no, con
 * la voz local del sistema. Devuelve false si no hay ninguna voz en español en este equipo.
 */
export async function hablar(texto: string, alTerminar?: () => void, voz = vozElegida()): Promise<boolean> {
  callar();
  const mio = ++turno;
  const frase = textoParaVoz(texto);
  const disponibles = (await estadoVozCache()).vocesNeuronales;
  if (voz !== 'sistema' && disponibles.includes(voz)) {
    try {
      const wav = await sintetizar(frase, voz);
      if (mio !== turno) return true; // se pidió callar mientras se generaba
      urlAudio = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      audio = new Audio(urlAudio);
      audio.onended = () => { soltarAudio(); alTerminar?.(); };
      audio.onerror = () => { soltarAudio(); alTerminar?.(); };
      await audio.play();
      return true;
    } catch {
      if (mio !== turno) return true;
      // Si la voz neuronal falla, se usa la del sistema.
    }
  }
  const sistema = await vozLocalEspanol();
  if (!sistema || mio !== turno) return !!sistema;
  const u = new SpeechSynthesisUtterance(frase);
  u.voice = sistema;
  u.lang = sistema.lang;
  u.rate = 1.05;
  u.onend = () => alTerminar?.();
  u.onerror = () => alTerminar?.();
  speechSynthesis.speak(u);
  return true;
}

export function callar(): void {
  turno++;
  soltarAudio();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** El estado de la voz cambia poco: se consulta una vez y se renueva al instalar. */
let cacheEstado: Promise<EstadoVoz> | null = null;
export function estadoVozCache(renovar = false): Promise<EstadoVoz> {
  if (renovar || !cacheEstado) cacheEstado = estadoVoz();
  return cacheEstado;
}
