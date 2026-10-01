import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  calentarModelo, clienteLlamaServer, intencionClara, preguntarConIA, preguntarConReglas,
  type ClienteLLM, type ContextoJarvis, type MensajeLLM, type RespuestaJarvis,
} from '@contafi/jarvis';
import { enTauri } from './base-tauri.ts';

/**
 * Catálogo FIJO de la IA local (sección 12.2): versiones y huellas SHA-256 verificadas.
 * No se descarga "la última versión": se descarga exactamente esto y se verifica.
 * (La versión marcada como "latest" de llama.cpp en GitHub no trae binarios.)
 */
export const CATALOGO_IA = {
  motor: {
    archivo: 'llama-b11321-bin-win-cpu-x64.zip',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11321/llama-b11321-bin-win-cpu-x64.zip',
    sha256: '8f8c0c6501b075f52deff59537c05acd57d8621a0a7935f29b7d7c4812892569',
    tamanoMB: 19,
  },
  modelos: [
    {
      id: 'qwen3-4b', nombre: 'Qwen3 4B', archivo: 'Qwen3-4B-Q4_K_M.gguf', licencia: 'Apache 2.0', tamanoMB: 2382, ramMinimaGB: 7.5,
      url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
      sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    },
    {
      id: 'qwen3-8b', nombre: 'Qwen3 8B', archivo: 'Qwen3-8B-Q4_K_M.gguf', licencia: 'Apache 2.0', tamanoMB: 4795, ramMinimaGB: 15.5,
      url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
      sha256: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785',
    },
  ],
} as const;

export type ModeloIA = (typeof CATALOGO_IA.modelos)[number];

/** Niveles según la RAM (sección 12.2): < 8 GB sin IA; 8–15 GB modelo de 4B; 16 GB o más, 8B. */
export function modeloRecomendado(ramGB: number): ModeloIA | null {
  return [...CATALOGO_IA.modelos].reverse().find((m) => ramGB >= m.ramMinimaGB) ?? null;
}

export interface EstadoIA {
  disponible: boolean; // la app puede usar IA en este entorno
  ramGB: number | null;
  recomendado: ModeloIA | null;
  motorInstalado: boolean;
  modelosDescargados: string[];
  externa: string | null; // URL de un llama-server externo (solo desarrollo)
}

/** Para desarrollo en el navegador: VITE_LLAMA_URL apunta a un llama-server ya corriendo. */
const URL_EXTERNA = import.meta.env.VITE_LLAMA_URL as string | undefined;
const TOKEN_EXTERNO = import.meta.env.VITE_LLAMA_TOKEN as string | undefined;

export async function estadoIA(): Promise<EstadoIA> {
  if (URL_EXTERNA) return { disponible: true, ramGB: null, recomendado: null, motorInstalado: true, modelosDescargados: ['(externo)'], externa: URL_EXTERNA };
  if (!enTauri()) return { disponible: false, ramGB: null, recomendado: null, motorInstalado: false, modelosDescargados: [], externa: null };
  const hw = await invoke<{ ram_gb: number; nucleos: number }>('ia_hardware');
  const a = await invoke<{ archivos: string[]; motor_instalado: boolean }>('ia_archivos');
  return {
    disponible: true, ramGB: hw.ram_gb, recomendado: modeloRecomendado(hw.ram_gb), motorInstalado: a.motor_instalado,
    modelosDescargados: a.archivos.filter((f) => f.endsWith('.gguf')), externa: null,
  };
}

/** Descarga el motor y el modelo (reanudable, verificado). `progreso` recibe porcentajes 0–100. */
export async function instalarIA(modelo: ModeloIA, progreso: (texto: string, porcentaje: number) => void): Promise<void> {
  const quitar = await listen<{ archivo: string; descargado: number; total: number }>('ia-descarga', (e) => {
    const { archivo, descargado, total } = e.payload;
    progreso(archivo === modelo.archivo ? `Modelo ${modelo.nombre}` : 'Motor de IA', total ? Math.floor((descargado / total) * 100) : 0);
  });
  try {
    const m = CATALOGO_IA.motor;
    await invoke('ia_descargar', { url: m.url, archivo: m.archivo, sha256: m.sha256, extraer: true });
    await invoke('ia_descargar', { url: modelo.url, archivo: modelo.archivo, sha256: modelo.sha256, extraer: false });
  } finally {
    quitar();
  }
}

// ------------------------------------------------------------------ ciclo de vida del servidor de IA

const MINUTOS_INACTIVIDAD = 5;
let cliente: ClienteLLM | null = null;
let arrancando: Promise<ClienteLLM | null> | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;

async function esperarSalud(url: string, token: string, segundos = 120): Promise<boolean> {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok && (await r.json() as { status?: string }).status === 'ok') return true;
    } catch { /* todavía arrancando */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** El proceso de IA arranca cuando se necesita y se apaga tras unos minutos sin uso (sección 12.2). */
async function obtenerCliente(estado: EstadoIA): Promise<ClienteLLM | null> {
  if (estado.externa) return clienteLlamaServer({ url: estado.externa, token: TOKEN_EXTERNO });
  if (cliente) return cliente;
  const modelo = estado.recomendado && estado.modelosDescargados.includes(estado.recomendado.archivo) ? estado.recomendado
    : CATALOGO_IA.modelos.find((m) => estado.modelosDescargados.includes(m.archivo));
  if (!estado.disponible || !estado.motorInstalado || !modelo) return null;
  arrancando ??= (async () => {
    const s = await invoke<{ url: string; token: string }>('ia_iniciar', { modelo: modelo.archivo });
    if (!(await esperarSalud(s.url, s.token))) { await invoke('ia_detener'); return null; }
    const nuevo = clienteLlamaServer({ url: s.url, token: s.token });
    // Las instrucciones y herramientas quedan en la caché del modelo antes de la primera pregunta.
    await calentarModelo(nuevo).catch(() => undefined);
    cliente = nuevo;
    return cliente;
  })().finally(() => { arrancando = null; });
  return arrancando;
}

function programarApagado() {
  if (temporizador) clearTimeout(temporizador);
  if (!enTauri() || URL_EXTERNA) return;
  temporizador = setTimeout(() => { cliente = null; void invoke('ia_detener'); }, MINUTOS_INACTIVIDAD * 60_000);
}

/** Arranca y calienta la IA en segundo plano al abrir Jarvis, para que la primera respuesta sea rápida. */
export function prepararJarvis(estado: EstadoIA): void {
  void obtenerCliente(estado).catch(() => null).then(() => programarApagado());
}

/**
 * Pregunta a Jarvis. Preguntas frecuentes y claras: reglas, al instante. Lo demás: IA si este PC la
 * tiene; si no, o si la IA falla, reglas. En todos los casos las cifras salen del motor.
 */
export async function preguntarJarvis(pregunta: string, ctx: ContextoJarvis, estado: EstadoIA, historial: MensajeLLM[] = []): Promise<RespuestaJarvis> {
  if (intencionClara(pregunta)) return preguntarConReglas(pregunta, ctx);
  const c = await obtenerCliente(estado).catch(() => null);
  if (!c) return preguntarConReglas(pregunta, ctx);
  try {
    return await preguntarConIA(pregunta, ctx, c, historial);
  } catch {
    cliente = null;
    return preguntarConReglas(pregunta, ctx);
  } finally {
    programarApagado();
  }
}
