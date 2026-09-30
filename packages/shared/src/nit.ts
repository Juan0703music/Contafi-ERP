/** Dígito de verificación del NIT (algoritmo módulo 11 de la DIAN). */
const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Deja solo los dígitos del NIT, sin el DV. "900.123.456-7" -> "900123456". */
export function limpiarNit(nit: string): string {
  const sinDv = nit.includes('-') ? nit.slice(0, nit.lastIndexOf('-')) : nit;
  return sinDv.replace(/\D/g, '');
}

export function calcularDV(nit: string): number {
  const digitos = limpiarNit(nit);
  if (digitos.length === 0 || digitos.length > PESOS.length) {
    throw new RangeError(`NIT inválido: "${nit}"`);
  }
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    const d = Number(digitos[digitos.length - 1 - i]);
    suma += d * PESOS[i]!;
  }
  const r = suma % 11;
  return r > 1 ? 11 - r : r;
}

/** Valida un NIT escrito con DV ("900123456-7" o "900.123.456-7"). */
export function validarNitConDV(nitConDv: string): boolean {
  const m = /^(.*)-(\d)$/.exec(nitConDv.trim());
  if (!m) return false;
  try {
    return calcularDV(m[1]!) === Number(m[2]);
  } catch {
    return false;
  }
}

export function formatearNit(nit: string): string {
  const d = limpiarNit(nit);
  return `${d.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${calcularDV(d)}`;
}
