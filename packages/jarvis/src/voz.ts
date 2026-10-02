/**
 * Voz de Jarvis. Todo local: el reconocimiento lo hace whisper.cpp en el PC y la lectura en voz alta la
 * voz del sistema operativo. Aquí solo la lógica pura (probada): preparar el texto para leerlo, convertir
 * el audio del micrófono a WAV de 16 kHz y detectar cuándo la persona terminó de hablar.
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Texto de una respuesta, como debe sonar: "$ 1.190.000" → "1190000 pesos" (si no, algunas voces dicen
 * "dólares" o leen los puntos), "2026-10-06" → "6 de octubre de 2026", "FV-000002" → "FV número 2".
 */
export function textoParaVoz(texto: string): string {
  return texto
    .replace(/\*\*|__|`/g, '')
    .replace(/(?:(−|-)\s?)?\$\s?(?:(−|-)\s?)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g, (_t, s1, s2, entero: string, dec?: string) => {
      const negativo = s1 || s2 ? 'menos ' : '';
      const pesos = entero.replace(/\./g, '');
      const centavos = dec && Number(dec) > 0 ? ` con ${Number(dec.padEnd(2, '0'))} centavos` : '';
      return `${negativo}${pesos} pesos${centavos}`;
    })
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (t, a: string, m: string, d: string) =>
      (Number(m) >= 1 && Number(m) <= 12 ? `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}` : t))
    .replace(/\b([A-Z]{2})-0*(\d+)\b/g, '$1 número $2')
    .replace(/\s*·\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Mezcla a mono no hace falta (el micrófono se pide en mono); baja la tasa a 16 kHz promediando. */
export function a16k(muestras: Float32Array, tasa: number): Float32Array {
  if (tasa === 16000) return muestras;
  if (tasa < 16000) throw new RangeError(`Tasa de muestreo muy baja: ${tasa} Hz`);
  const razon = tasa / 16000;
  const salida = new Float32Array(Math.floor(muestras.length / razon));
  for (let i = 0; i < salida.length; i++) {
    const desde = Math.floor(i * razon);
    const hasta = Math.min(muestras.length, Math.floor((i + 1) * razon));
    let suma = 0;
    for (let j = desde; j < hasta; j++) suma += muestras[j]!;
    salida[i] = suma / Math.max(1, hasta - desde);
  }
  return salida;
}

/** WAV PCM de 16 bits, mono: lo que lee whisper.cpp sin necesitar ffmpeg. */
export function codificarWav(muestras: Float32Array, tasa = 16000): Uint8Array<ArrayBuffer> {
  const datos = muestras.length * 2;
  const buffer = new ArrayBuffer(44 + datos);
  const v = new DataView(buffer);
  const ascii = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + datos, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, tasa, true); v.setUint32(28, tasa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, datos, true);
  for (let i = 0; i < muestras.length; i++) {
    const x = Math.max(-1, Math.min(1, muestras[i]!));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export const nivel = (bloque: Float32Array) => {
  let s = 0;
  for (const x of bloque) s += x * x;
  return Math.sqrt(s / Math.max(1, bloque.length));
};

export interface OpcionesDetector {
  /** Silencio, después de hablar, que da por terminada la pregunta (ms). */
  silencioFinal: number;
  /** Si no empieza a hablar en este tiempo, se cancela (ms). */
  esperaMaxima: number;
  /** Duración máxima de una pregunta (ms): whisper se configura para ~15 s. */
  duracionMaxima: number;
}

export type EstadoDetector = 'esperando' | 'hablando' | 'fin' | 'sin-voz';

/**
 * Detecta el inicio y el final de la voz con el nivel de cada bloque, contra el ruido de fondo que mide
 * al comienzo (cada micrófono y cada oficina suenan distinto).
 */
export class DetectorVoz {
  private o: OpcionesDetector;
  private transcurrido = 0;
  private ruido: number | null = null;
  private muestrasRuido: number[] = [];
  private silencio = 0;
  private habla = 0;
  estado: EstadoDetector = 'esperando';

  constructor(o: Partial<OpcionesDetector> = {}) {
    this.o = { silencioFinal: 1200, esperaMaxima: 7000, duracionMaxima: 14000, ...o };
  }

  /** Procesa un bloque de audio de `ms` milisegundos y devuelve el estado. */
  procesar(bloque: Float32Array, ms: number): EstadoDetector {
    if (this.estado === 'fin' || this.estado === 'sin-voz') return this.estado;
    this.transcurrido += ms;
    const n = nivel(bloque);
    if (this.ruido === null) {
      // Los primeros 300 ms miden el ruido de fondo.
      this.muestrasRuido.push(n);
      if (this.transcurrido >= 300) this.ruido = this.muestrasRuido.reduce((a, b) => a + b, 0) / this.muestrasRuido.length;
      return this.estado;
    }
    const umbral = Math.max(0.012, this.ruido * 3);
    if (n > umbral) {
      this.habla += ms;
      this.silencio = 0;
      if (this.habla >= 150) this.estado = 'hablando';
    } else {
      this.silencio += ms;
      if (this.estado === 'esperando') this.habla = 0;
    }
    if (this.estado === 'hablando' && (this.silencio >= this.o.silencioFinal || this.transcurrido >= this.o.duracionMaxima)) this.estado = 'fin';
    if (this.estado === 'esperando' && this.transcurrido >= this.o.esperaMaxima) this.estado = 'sin-voz';
    return this.estado;
  }
}

/** Vocabulario que se le da a whisper como pista: mejora mucho "IVA", "bimestre", "cartera"… */
export const PISTA_VOCABULARIO =
  'Preguntas a Jarvis, el asistente contable de Contafi: saldo en bancos y caja, cartera, cuentas por pagar, proveedores, '
  + 'IVA del bimestre, retención en la fuente, estado de resultados, balance general, utilidad, vencimientos, DIAN, NIT.';
