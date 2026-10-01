import { leerMontoUsuario, type FechaISO } from '@contafi/shared';
import { cargarDatos, serializar, type ContextoJarvis, type DatosEmpresa } from './datos.ts';
import { HERRAMIENTAS, definicionesOpenAI } from './herramientas.ts';

// ------------------------------------------------------------------ cliente del modelo

export interface MensajeLLM {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface RespuestaLLM {
  contenido: string | null;
  llamadas: { id: string; nombre: string; argumentos: string }[];
}

export interface ClienteLLM {
  completar(mensajes: MensajeLLM[], herramientas: ReturnType<typeof definicionesOpenAI>): Promise<RespuestaLLM>;
}

/** Cliente para llama-server (API compatible con OpenAI) en 127.0.0.1 con token de sesión (sección 10). */
export function clienteLlamaServer(o: { url: string; token?: string; fetch?: typeof fetch; tiempoMaximoMs?: number }): ClienteLLM {
  const f = o.fetch ?? globalThis.fetch;
  return {
    async completar(mensajes, herramientas) {
      const res = await f(`${o.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
        body: JSON.stringify({
          messages: mensajes, tools: herramientas, tool_choice: 'auto', temperature: 0.1, max_tokens: 160,
          cache_prompt: true,
          // Modelos Qwen3: sin "modo pensamiento", para responder rápido en PC modestos.
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(o.tiempoMaximoMs ?? 120_000),
      });
      if (!res.ok) throw new Error(`El modelo respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json() as { choices: { message: { content?: string | null; tool_calls?: { id?: string; function: { name: string; arguments: string | object } }[] } }[] };
      const m = j.choices[0]?.message ?? {};
      return {
        contenido: m.content ?? null,
        llamadas: (m.tool_calls ?? []).map((t, i) => ({
          id: t.id ?? `llamada-${i}`, nombre: t.function.name,
          argumentos: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments),
        })),
      };
    },
  };
}

// ------------------------------------------------------------------ verificación de cifras (sección 12.1)

const PATRON_MONTO = /-?\s?\$\s?-?\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g;

/**
 * "La IA no calcula": toda cifra en pesos de la respuesta debe estar en lo que devolvieron las
 * herramientas. Devuelve las que no aparecen (posibles cifras inventadas o mal copiadas).
 */
export function verificarCifras(texto: string, cifras: ReadonlySet<bigint>): string[] {
  const sospechosas: string[] = [];
  for (const m of texto.matchAll(PATRON_MONTO)) {
    const crudo = m[0].trim();
    const v = leerMontoUsuario(crudo.replace(/[$\s-]/g, ''));
    if (v === null) continue;
    if (!cifras.has(v) && !cifras.has(-v)) sospechosas.push(crudo);
  }
  return sospechosas;
}

// ------------------------------------------------------------------ respuesta

export interface RespuestaJarvis {
  texto: string;
  herramientas: { nombre: string; argumentos: Record<string, unknown>; resultado: unknown }[];
  /** Cifras de la respuesta que no vienen de las herramientas (vacío = todo verificado). */
  cifrasNoVerificadas: string[];
  /** Hay comprobantes sin número oficial: los datos son a la última sincronización. */
  provisional: boolean;
  motor: 'ia' | 'reglas';
  milisegundos: number;
}

/**
 * Instrucciones FIJAS (sin empresa ni fecha): así el modelo procesa una sola vez instrucciones y
 * herramientas (~1.900 tokens, más de un minuto en un PC modesto) y las reutiliza de su caché en
 * todas las preguntas, empresas y días. La empresa y la fecha van en cada pregunta.
 */
export function instruccionesSistema(): string {
  return [
    'Eres Jarvis, el asistente contable de Contafi para empresas colombianas. Cada pregunta trae entre corchetes la empresa y la fecha de hoy.',
    'Reglas obligatorias:',
    '1. NUNCA calcules, sumes ni inventes cifras. Toda cifra debe salir de una herramienta; cópiala EXACTAMENTE como la devuelve (con el signo $ y los puntos de miles).',
    '2. Si la pregunta necesita datos de la empresa, llama la herramienta adecuada antes de responder.',
    '3. Las fechas van en formato AAAA-MM-DD. "Este mes" es desde el día 1 del mes actual hasta hoy; "este año", desde el 1 de enero.',
    '4. Responde en español de Colombia, en una o dos frases cortas, sin tablas ni markdown.',
    '5. Si ninguna herramienta sirve, di con qué sí puedes ayudar. Das orientación; no reemplazas el criterio del contador.',
  ].join('\n');
}

const quitarPensamiento = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** Pregunta con IA: el modelo elige herramientas; el motor calcula; se verifican las cifras. */
export async function preguntarConIA(
  pregunta: string, ctx: ContextoJarvis, cliente: ClienteLLM, historial: MensajeLLM[] = [], maxRondas = 4,
): Promise<RespuestaJarvis> {
  const inicio = Date.now();
  const d = await cargarDatos(ctx);
  const cifras = new Set<bigint>();
  const usadas: RespuestaJarvis['herramientas'] = [];
  const mensajes: MensajeLLM[] = [
    { role: 'system', content: instruccionesSistema() },
    ...historial,
    { role: 'user', content: `[Empresa: ${ctx.empresa.razon_social} · Hoy: ${d.hoy}]\n${pregunta}` },
  ];
  const definiciones = definicionesOpenAI();
  let texto = '';
  for (let ronda = 0; ronda < maxRondas; ronda++) {
    const r = await cliente.completar(mensajes, definiciones);
    if (!r.llamadas.length) {
      texto = quitarPensamiento(r.contenido ?? '');
      break;
    }
    mensajes.push({ role: 'assistant', content: r.contenido, tool_calls: r.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } })) });
    for (const l of r.llamadas) {
      const resultado = ejecutarHerramienta(l.nombre, l.argumentos, d, cifras);
      usadas.push({ nombre: l.nombre, argumentos: resultado.argumentos, resultado: resultado.salida });
      mensajes.push({ role: 'tool', tool_call_id: l.id, content: JSON.stringify(resultado.salida) });
    }
  }
  if (!texto) texto = 'No pude completar la respuesta. Intente con una pregunta más concreta.';
  return {
    texto, herramientas: usadas, cifrasNoVerificadas: verificarCifras(texto, cifras),
    provisional: d.sync.pendientes > 0, motor: 'ia', milisegundos: Date.now() - inicio,
  };
}

export function ejecutarHerramienta(nombre: string, argumentosJson: string, d: DatosEmpresa, cifras: Set<bigint>) {
  const h = HERRAMIENTAS.find((x) => x.nombre === nombre);
  let argumentos: Record<string, unknown> = {};
  try {
    argumentos = argumentosJson ? JSON.parse(argumentosJson) as Record<string, unknown> : {};
  } catch {
    return { argumentos, salida: { error: 'Argumentos inválidos.' } };
  }
  if (!h) return { argumentos, salida: { error: `No existe la herramienta ${nombre}.` } };
  try {
    return { argumentos, salida: serializar(h.ejecutar(argumentos, d), cifras) };
  } catch (e) {
    return { argumentos, salida: { error: (e as Error).message } };
  }
}

/**
 * Calienta la caché del modelo con las instrucciones y las herramientas apenas arranca, para que la
 * primera pregunta del contador no pague ese costo (más de un minuto en un PC de gama baja).
 */
export async function calentarModelo(cliente: ClienteLLM): Promise<void> {
  await cliente.completar([{ role: 'system', content: instruccionesSistema() }, { role: 'user', content: 'Hola' }], definicionesOpenAI());
}
