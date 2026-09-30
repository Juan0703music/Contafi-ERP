import { codigoPadre, type Centavos, type FechaISO, type Naturaleza } from '@contafi/shared';
import { EN_LIBROS, type Comprobante, type Cuenta } from './tipos.ts';

export interface Movimiento {
  debito: Centavos;
  credito: Centavos;
}

export interface FiltroFechas {
  desde?: FechaISO;
  hasta?: FechaISO;
}

function enRango(fecha: FechaISO, f: FiltroFechas): boolean {
  return (!f.desde || fecha >= f.desde) && (!f.hasta || fecha <= f.hasta);
}

/** Suma débitos y créditos por cuenta auxiliar, solo de comprobantes en libros. */
export function movimientosPorCuenta(comprobantes: Iterable<Comprobante>, filtro: FiltroFechas = {}): Map<string, Movimiento> {
  const mapa = new Map<string, Movimiento>();
  for (const c of comprobantes) {
    if (!EN_LIBROS.has(c.estado) || !enRango(c.fecha, filtro)) continue;
    for (const l of c.lineas) {
      const m = mapa.get(l.cuenta) ?? { debito: 0n, credito: 0n };
      m.debito += l.debito;
      m.credito += l.credito;
      mapa.set(l.cuenta, m);
    }
  }
  return mapa;
}

/** Saldo con el signo de la naturaleza: positivo si está en su lado normal. */
export function saldoSegunNaturaleza(m: Movimiento, naturaleza: Naturaleza): Centavos {
  return naturaleza === 'D' ? m.debito - m.credito : m.credito - m.debito;
}

export interface FilaBalancePrueba {
  codigo: string;
  nombre: string;
  nivel: number;
  naturaleza: Naturaleza;
  saldoInicial: Centavos; // débito − crédito
  debitos: Centavos;
  creditos: Centavos;
  saldoFinal: Centavos; // débito − crédito
}

export interface BalancePrueba {
  filas: FilaBalancePrueba[];
  totalDebitos: Centavos;
  totalCreditos: Centavos;
  totalSaldoInicial: Centavos;
  totalSaldoFinal: Centavos;
  cuadra: boolean;
}

function nivelDe(codigo: string): number {
  return codigo.length === 1 ? 1 : codigo.length === 2 ? 2 : codigo.length === 4 ? 3 : codigo.length === 6 ? 4 : 5;
}

/**
 * Balance de prueba por niveles (regla 9: siempre cuadra).
 * Saldos expresados como débito − crédito; las filas de mayor incluyen la suma de sus auxiliares.
 */
export function balancePrueba(
  cuentas: Iterable<Cuenta>,
  comprobantes: readonly Comprobante[],
  periodo: { desde: FechaISO; hasta: FechaISO },
  opciones: { nivelMaximo?: number; incluirEnCero?: boolean } = {},
): BalancePrueba {
  const porCodigo = new Map<string, Cuenta>();
  for (const c of cuentas) porCodigo.set(c.codigo, c);

  const antes = movimientosPorCuenta(comprobantes, { hasta: diaAnterior(periodo.desde) });
  const durante = movimientosPorCuenta(comprobantes, periodo);

  const acumulado = new Map<string, { inicial: bigint; debitos: bigint; creditos: bigint }>();
  const acumular = (codigo: string, inicial: bigint, debitos: bigint, creditos: bigint) => {
    for (let c: string | null = codigo; c; c = codigoPadre(c)) {
      const a = acumulado.get(c) ?? { inicial: 0n, debitos: 0n, creditos: 0n };
      a.inicial += inicial;
      a.debitos += debitos;
      a.creditos += creditos;
      acumulado.set(c, a);
    }
  };

  const auxiliares = new Set([...antes.keys(), ...durante.keys()]);
  let totalDebitos = 0n, totalCreditos = 0n, totalSaldoInicial = 0n, totalSaldoFinal = 0n;
  for (const codigo of auxiliares) {
    const a = antes.get(codigo) ?? { debito: 0n, credito: 0n };
    const d = durante.get(codigo) ?? { debito: 0n, credito: 0n };
    const inicial = a.debito - a.credito;
    acumular(codigo, inicial, d.debito, d.credito);
    totalDebitos += d.debito;
    totalCreditos += d.credito;
    totalSaldoInicial += inicial;
    totalSaldoFinal += inicial + d.debito - d.credito;
  }

  const nivelMaximo = opciones.nivelMaximo ?? 5;
  const filas: FilaBalancePrueba[] = [];
  for (const [codigo, a] of [...acumulado.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const nivel = nivelDe(codigo);
    if (nivel > nivelMaximo) continue;
    const final = a.inicial + a.debitos - a.creditos;
    if (!opciones.incluirEnCero && a.inicial === 0n && a.debitos === 0n && a.creditos === 0n) continue;
    const cuenta = porCodigo.get(codigo);
    filas.push({
      codigo,
      nombre: cuenta?.nombre ?? '(cuenta no registrada)',
      nivel,
      naturaleza: cuenta?.naturaleza ?? (['1', '5', '6', '7'].includes(codigo[0]!) ? 'D' : 'C'),
      saldoInicial: a.inicial,
      debitos: a.debitos,
      creditos: a.creditos,
      saldoFinal: final,
    });
  }

  return {
    filas,
    totalDebitos,
    totalCreditos,
    totalSaldoInicial,
    totalSaldoFinal,
    cuadra: totalDebitos === totalCreditos && totalSaldoInicial === 0n && totalSaldoFinal === 0n,
  };
}

function diaAnterior(f: FechaISO): FechaISO {
  const d = new Date(Date.parse(`${f}T00:00:00Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Suma (crédito − débito) de las cuentas cuyo código empieza por alguno de los prefijos. */
function neto(mov: Map<string, Movimiento>, prefijos: readonly string[], lado: 'D' | 'C'): Centavos {
  let t = 0n;
  for (const [codigo, m] of mov) {
    if (prefijos.some((p) => codigo.startsWith(p))) t += lado === 'C' ? m.credito - m.debito : m.debito - m.credito;
  }
  return t;
}

export interface EstadoResultados {
  ingresosOperacionales: Centavos;
  ingresosNoOperacionales: Centavos;
  costos: Centavos;
  utilidadBruta: Centavos;
  gastosOperacionales: Centavos;
  utilidadOperacional: Centavos;
  gastosNoOperacionales: Centavos;
  utilidadAntesDeImpuestos: Centavos;
  impuestoRenta: Centavos;
  utilidadNeta: Centavos;
}

/** Estado de resultados del rango (PUC comerciante: 41/42 ingresos, 6/7 costos, 51/52 y 53 gastos, 54 renta). */
export function estadoResultados(comprobantes: readonly Comprobante[], rango: FiltroFechas): EstadoResultados {
  // El comprobante de cierre anual se excluye: si no, el resultado del año quedaría en cero.
  const mov = movimientosPorCuenta(comprobantes.filter((c) => c.origen !== 'cierre_anual'), rango);
  const ingresosOperacionales = neto(mov, ['41'], 'C');
  const ingresosNoOperacionales = neto(mov, ['42'], 'C');
  const costos = neto(mov, ['6', '7'], 'D');
  const gastosOperacionales = neto(mov, ['51', '52'], 'D');
  const gastosNoOperacionales = neto(mov, ['53'], 'D');
  const impuestoRenta = neto(mov, ['54'], 'D');
  const utilidadBruta = ingresosOperacionales - costos;
  const utilidadOperacional = utilidadBruta - gastosOperacionales;
  const utilidadAntesDeImpuestos = utilidadOperacional + ingresosNoOperacionales - gastosNoOperacionales;
  return {
    ingresosOperacionales, ingresosNoOperacionales, costos, utilidadBruta, gastosOperacionales,
    utilidadOperacional, gastosNoOperacionales, utilidadAntesDeImpuestos, impuestoRenta,
    utilidadNeta: utilidadAntesDeImpuestos - impuestoRenta,
  };
}

export interface BalanceGeneral {
  activo: Centavos;
  pasivo: Centavos;
  patrimonio: Centavos; // clase 3 contabilizada
  resultadoDelEjercicio: Centavos; // clases 4 a 7 aún no cerradas
  totalPasivoYPatrimonio: Centavos;
  cuadra: boolean;
}

/** Estado de situación financiera a una fecha de corte (regla 9: activo = pasivo + patrimonio). */
export function balanceGeneral(comprobantes: readonly Comprobante[], corte: FechaISO): BalanceGeneral {
  const mov = movimientosPorCuenta(comprobantes, { hasta: corte });
  const activo = neto(mov, ['1'], 'D');
  const pasivo = neto(mov, ['2'], 'C');
  const patrimonio = neto(mov, ['3'], 'C');
  const resultadoDelEjercicio = neto(mov, ['4'], 'C') - neto(mov, ['5', '6', '7'], 'D');
  const totalPasivoYPatrimonio = pasivo + patrimonio + resultadoDelEjercicio;
  return { activo, pasivo, patrimonio, resultadoDelEjercicio, totalPasivoYPatrimonio, cuadra: activo === totalPasivoYPatrimonio };
}

export interface FilaAuxiliar {
  comprobanteId: string;
  numero: string | null;
  fecha: FechaISO;
  concepto: string;
  terceroId: string | null;
  debito: Centavos;
  credito: Centavos;
  saldo: Centavos; // débito − crédito acumulado
}

/** Libro auxiliar de una cuenta (opcionalmente de un tercero). Incluye subcuentas si se pasa un código de mayor. */
export function auxiliar(
  comprobantes: readonly Comprobante[],
  cuenta: string,
  opciones: FiltroFechas & { terceroId?: string } = {},
): { saldoInicial: Centavos; filas: FilaAuxiliar[]; saldoFinal: Centavos } {
  const coincide = (codigo: string, terceroId: string | null | undefined) =>
    codigo.startsWith(cuenta) && (!opciones.terceroId || terceroId === opciones.terceroId);
  let saldoInicial = 0n;
  const filas: FilaAuxiliar[] = [];
  const ordenados = [...comprobantes]
    .filter((c) => EN_LIBROS.has(c.estado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.numero ?? '').localeCompare(b.numero ?? ''));
  for (const c of ordenados) {
    for (const l of c.lineas) {
      if (!coincide(l.cuenta, l.terceroId)) continue;
      if (opciones.desde && c.fecha < opciones.desde) { saldoInicial += l.debito - l.credito; continue; }
      if (opciones.hasta && c.fecha > opciones.hasta) continue;
      filas.push({
        comprobanteId: c.id, numero: c.numero, fecha: c.fecha, concepto: l.nota ?? c.concepto,
        terceroId: l.terceroId ?? null, debito: l.debito, credito: l.credito, saldo: 0n,
      });
    }
  }
  let saldo = saldoInicial;
  for (const f of filas) { saldo += f.debito - f.credito; f.saldo = saldo; }
  return { saldoInicial, filas, saldoFinal: saldo };
}
