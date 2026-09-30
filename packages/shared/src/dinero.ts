/**
 * Dinero en centavos enteros (bigint). Regla del plan (sección 6.2):
 * NUNCA usar el tipo `number` de JavaScript para montos.
 *
 * Política de redondeo (regla 8 del motor): mitad hacia arriba, alejándose de cero,
 * a centavos exactos. Los impuestos se redondean POR LÍNEA/SUBTOTAL de impuesto, que es
 * como los reporta el XML UBL de la DIAN. Confirmar con el contador asesor.
 */
export type Centavos = bigint;

export const CERO: Centavos = 0n;

/** Tarifa expresada en millonésimas: 19 % = 190_000; 4,14 por mil = 4_140. */
export type TarifaPpm = bigint;

export const PPM = 1_000_000n;

/** División entera con redondeo mitad-alejándose-de-cero. */
export function dividirRedondeado(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new RangeError('División por cero');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const q = (n * 2n + d) / (d * 2n);
  return negativo ? -q : q;
}

/** Aplica una tarifa a una base: base × tarifa, redondeado a centavos. */
export function aplicarTarifa(base: Centavos, tarifa: TarifaPpm): Centavos {
  return dividirRedondeado(base * tarifa, PPM);
}

/**
 * Convierte texto decimal a centavos sin pasar por punto flotante.
 * Acepta "1234567.89", "1234567,89", "1.234.567,89" y "-15.5".
 * Si el texto trae más de dos decimales, redondea con la política estándar.
 */
export function aCentavos(texto: string | number | bigint): Centavos {
  if (typeof texto === 'bigint') return texto * 100n;
  if (typeof texto === 'number') {
    if (!Number.isSafeInteger(texto)) {
      throw new TypeError('Use texto decimal para montos con decimales; number solo para enteros.');
    }
    return BigInt(texto) * 100n;
  }
  let s = texto.trim().replace(/\s|\$/g, '');
  if (s === '') throw new TypeError('Monto vacío');
  // Formato colombiano "1.234.567,89": el punto es separador de miles.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TypeError(`Monto inválido: "${texto}"`);
  const negativo = s.startsWith('-');
  if (negativo) s = s.slice(1);
  const [entero = '0', dec = ''] = s.split('.');
  if (dec.length <= 2) {
    const c = BigInt(entero) * 100n + BigInt(dec.padEnd(2, '0'));
    return negativo ? -c : c;
  }
  const escala = 10n ** BigInt(dec.length);
  const total = BigInt(entero) * escala + BigInt(dec);
  const c = dividirRedondeado(total * 100n, escala);
  return negativo ? -c : c;
}

/**
 * Lee un monto escrito por una persona en Colombia. A diferencia de `aCentavos` (formato de máquina),
 * un punto seguido de grupos de 3 dígitos es separador de miles: "1.234" = mil doscientos treinta y cuatro.
 * Acepta "$ 1.234.567,89", "1234567,89", "1234567.89", "1.234" y "1234". Devuelve null si no es un monto.
 */
export function leerMontoUsuario(texto: string): Centavos | null {
  let t = texto.trim().replace(/\s|\$/g, '');
  if (t === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // solo separadores de miles
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)([.,]\d+)?$/.test(t)) return null;
  try {
    return aCentavos(t);
  } catch {
    return null;
  }
}

/** Lee una tarifa escrita como porcentaje ("19", "2,5", "0,966 %") y la devuelve en millonésimas. */
export function leerTarifaUsuario(texto: string): TarifaPpm | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,4}))?$/.exec(texto.trim().replace(/\s|%/g, ''));
  if (!m) return null;
  const ppm = BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
  return ppm <= 1_000_000n ? ppm : null;
}

/** 190000 -> "19 %"; 9660 -> "0,966 %". */
export function formatoTarifa(ppm: TarifaPpm): string {
  const dec = (ppm % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${ppm / 10_000n}${dec ? `,${dec}` : ''} %`;
}

/** "1234567.89" — formato de intercambio (XML, JSON, base de datos numeric). */
export function aDecimal(c: Centavos): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const s = `${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** "$ 1.234.567,89" — formato para mostrar en Colombia. */
export function formatoCOP(c: Centavos, opciones: { decimales?: boolean } = {}): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const miles = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = opciones.decimales === false ? '' : `,${(a % 100n).toString().padStart(2, '0')}`;
  return `${neg ? '-' : ''}$ ${miles}${dec}`;
}

export function sumar(valores: Iterable<Centavos>): Centavos {
  let t = 0n;
  for (const v of valores) t += v;
  return t;
}

/** Parte un monto en `partes` proporcionales sin perder centavos (la diferencia va a la última). */
export function prorratear(total: Centavos, pesos: readonly bigint[]): Centavos[] {
  const suma = pesos.reduce((a, b) => a + b, 0n);
  if (suma === 0n) throw new RangeError('Los pesos del prorrateo suman cero');
  const partes = pesos.map((p) => dividirRedondeado(total * p, suma));
  const diferencia = total - partes.reduce((a, b) => a + b, 0n);
  partes[partes.length - 1] = (partes[partes.length - 1] ?? 0n) + diferencia;
  return partes;
}
