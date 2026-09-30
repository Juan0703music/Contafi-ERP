import type { Centavos, FechaISO } from '@contafi/shared';
import { balancePrueba, movimientosPorCuenta, type FiltroFechas, type FilaBalancePrueba } from './reportes.ts';
import { EN_LIBROS, type Comprobante, type Cuenta, type Linea } from './tipos.ts';

// ------------------------------------------------------------------ libro diario

export interface AsientoDiario {
  comprobanteId: string;
  numero: string;
  tipo: string;
  fecha: FechaISO;
  concepto: string;
  lineas: (Linea & { nombreCuenta: string })[];
  debitos: Centavos;
  creditos: Centavos;
}

export interface LibroDiario {
  asientos: AsientoDiario[];
  totalDebitos: Centavos;
  totalCreditos: Centavos;
}

/** Libro diario (Código de Comercio, art. 48 y ss.): comprobantes en libros, en orden cronológico. */
export function libroDiario(cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], rango: FiltroFechas): LibroDiario {
  const nombres = new Map([...cuentas].map((c) => [c.codigo, c.nombre]));
  const asientos = comprobantes
    .filter((c) => EN_LIBROS.has(c.estado) && (!rango.desde || c.fecha >= rango.desde) && (!rango.hasta || c.fecha <= rango.hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.numero ?? '').localeCompare(b.numero ?? ''))
    .map((c) => ({
      comprobanteId: c.id, numero: c.numero ?? c.id, tipo: c.tipo, fecha: c.fecha, concepto: c.concepto,
      lineas: c.lineas.map((l) => ({ ...l, nombreCuenta: nombres.get(l.cuenta) ?? '' })),
      debitos: c.lineas.reduce((s, l) => s + l.debito, 0n),
      creditos: c.lineas.reduce((s, l) => s + l.credito, 0n),
    }));
  return {
    asientos,
    totalDebitos: asientos.reduce((s, a) => s + a.debitos, 0n),
    totalCreditos: asientos.reduce((s, a) => s + a.creditos, 0n),
  };
}

// ------------------------------------------------------------------ libro mayor y balances

/** Libro mayor y balances: saldo inicial, movimientos y saldo final por cuenta de mayor (4 dígitos). */
export function libroMayor(
  cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], periodo: { desde: FechaISO; hasta: FechaISO },
): { filas: FilaBalancePrueba[]; totalDebitos: Centavos; totalCreditos: Centavos; cuadra: boolean } {
  const bp = balancePrueba(cuentas, comprobantes, periodo, { nivelMaximo: 3 });
  return { filas: bp.filas.filter((f) => f.nivel === 3), totalDebitos: bp.totalDebitos, totalCreditos: bp.totalCreditos, cuadra: bp.cuadra };
}

// ------------------------------------------------------------------ estados financieros

export interface RenglonEstado {
  codigo: string;
  nombre: string;
  valor: Centavos;
}

export interface SeccionEstado {
  titulo: string;
  renglones: RenglonEstado[];
  total: Centavos;
}

/**
 * Clasificación corriente / no corriente por grupo del PUC. SIMPLIFICADA: el contador asesor debe
 * validarla; las porciones de largo plazo de deudores u obligaciones requieren subcuentas propias.
 */
export const CLASIFICACION_ESF = {
  activoCorriente: ['11', '12', '13', '14'],
  activoNoCorriente: ['15', '16', '17', '18', '19'],
  pasivoCorriente: ['21', '22', '23', '24', '25', '26', '27', '28'],
  pasivoNoCorriente: ['29'],
} as const;

function saldosPorPrefijo(mov: Map<string, { debito: bigint; credito: bigint }>, largo: number): Map<string, bigint> {
  const r = new Map<string, bigint>();
  for (const [codigo, m] of mov) {
    const clave = codigo.slice(0, largo);
    r.set(clave, (r.get(clave) ?? 0n) + m.debito - m.credito);
  }
  return r;
}

function seccion(titulo: string, grupos: readonly string[], saldos: Map<string, bigint>, nombres: Map<string, string>, signo: 1n | -1n): SeccionEstado {
  const renglones = grupos
    .map((g) => ({ codigo: g, nombre: nombres.get(g) ?? g, valor: (saldos.get(g) ?? 0n) * signo }))
    .filter((r) => r.valor !== 0n);
  return { titulo, renglones, total: renglones.reduce((s, r) => s + r.valor, 0n) };
}

export interface EstadoSituacionFinanciera {
  corte: FechaISO;
  activoCorriente: SeccionEstado;
  activoNoCorriente: SeccionEstado;
  totalActivo: Centavos;
  pasivoCorriente: SeccionEstado;
  pasivoNoCorriente: SeccionEstado;
  totalPasivo: Centavos;
  patrimonio: SeccionEstado; // incluye el resultado del ejercicio no cerrado
  totalPasivoYPatrimonio: Centavos;
  cuadra: boolean;
}

/** Estado de situación financiera a una fecha de corte (NIIF para Pymes, presentación por grupos del PUC). */
export function estadoSituacionFinanciera(cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], corte: FechaISO): EstadoSituacionFinanciera {
  const nombres = new Map([...cuentas].map((c) => [c.codigo, c.nombre]));
  const mov = movimientosPorCuenta(comprobantes, { hasta: corte });
  const grupos = saldosPorPrefijo(mov, 2);
  const clases = saldosPorPrefijo(mov, 1);

  const activoCorriente = seccion('Activo corriente', CLASIFICACION_ESF.activoCorriente, grupos, nombres, 1n);
  const activoNoCorriente = seccion('Activo no corriente', CLASIFICACION_ESF.activoNoCorriente, grupos, nombres, 1n);
  const pasivoCorriente = seccion('Pasivo corriente', CLASIFICACION_ESF.pasivoCorriente, grupos, nombres, -1n);
  const pasivoNoCorriente = seccion('Pasivo no corriente', CLASIFICACION_ESF.pasivoNoCorriente, grupos, nombres, -1n);

  const gruposPatrimonio = [...grupos.keys()].filter((g) => g.startsWith('3')).sort();
  const patrimonio = seccion('Patrimonio', gruposPatrimonio, grupos, nombres, -1n);
  // Resultado del ejercicio aún no trasladado por el cierre anual (clases 4 a 7).
  const resultado = -((clases.get('4') ?? 0n) + (clases.get('5') ?? 0n) + (clases.get('6') ?? 0n) + (clases.get('7') ?? 0n));
  if (resultado !== 0n) {
    patrimonio.renglones.push({ codigo: '', nombre: resultado > 0n ? 'Utilidad del ejercicio (sin cerrar)' : 'Pérdida del ejercicio (sin cerrar)', valor: resultado });
    patrimonio.total += resultado;
  }

  // Grupos de activo o pasivo que no estén en la clasificación se suman para que nada se pierda.
  const clasificados = new Set<string>([...CLASIFICACION_ESF.activoCorriente, ...CLASIFICACION_ESF.activoNoCorriente,
    ...CLASIFICACION_ESF.pasivoCorriente, ...CLASIFICACION_ESF.pasivoNoCorriente]);
  for (const [g, v] of grupos) {
    if (clasificados.has(g) || v === 0n) continue;
    if (g.startsWith('1')) {
      activoNoCorriente.renglones.push({ codigo: g, nombre: nombres.get(g) ?? g, valor: v });
      activoNoCorriente.total += v;
    } else if (g.startsWith('2')) {
      pasivoCorriente.renglones.push({ codigo: g, nombre: nombres.get(g) ?? g, valor: -v });
      pasivoCorriente.total -= v;
    }
  }

  const totalActivo = activoCorriente.total + activoNoCorriente.total;
  const totalPasivo = pasivoCorriente.total + pasivoNoCorriente.total;
  const totalPasivoYPatrimonio = totalPasivo + patrimonio.total;
  return {
    corte, activoCorriente, activoNoCorriente, totalActivo, pasivoCorriente, pasivoNoCorriente, totalPasivo,
    patrimonio, totalPasivoYPatrimonio, cuadra: totalActivo === totalPasivoYPatrimonio,
  };
}

export interface EstadoResultadosDetallado {
  desde: FechaISO;
  hasta: FechaISO;
  secciones: (SeccionEstado & { naturaleza: 'ingreso' | 'gasto' })[];
  utilidadBruta: Centavos;
  utilidadOperacional: Centavos;
  utilidadAntesDeImpuestos: Centavos;
  utilidadNeta: Centavos;
}

/** Estado de resultados por cuentas de mayor (4 dígitos) dentro de cada sección. */
export function estadoResultadosDetallado(
  cuentas: Iterable<Cuenta>, comprobantes: readonly Comprobante[], rango: { desde: FechaISO; hasta: FechaISO },
): EstadoResultadosDetallado {
  const nombres = new Map([...cuentas].map((c) => [c.codigo, c.nombre]));
  const mov = movimientosPorCuenta(comprobantes.filter((c) => c.origen !== 'cierre_anual'), rango);
  const mayores = saldosPorPrefijo(mov, 4);
  const armar = (titulo: string, prefijos: string[], naturaleza: 'ingreso' | 'gasto') => {
    const codigos = [...mayores.keys()].filter((k) => prefijos.some((p) => k.startsWith(p))).sort();
    return { ...seccion(titulo, codigos, mayores, nombres, naturaleza === 'ingreso' ? -1n : 1n), naturaleza };
  };
  const ingresos = armar('Ingresos operacionales', ['41'], 'ingreso');
  const costos = armar('Costo de ventas', ['6', '7'], 'gasto');
  const gastosAdmin = armar('Gastos de administración', ['51'], 'gasto');
  const gastosVentas = armar('Gastos de ventas', ['52'], 'gasto');
  const otrosIngresos = armar('Otros ingresos', ['42'], 'ingreso');
  const otrosGastos = armar('Otros gastos', ['53'], 'gasto');
  const renta = armar('Impuesto de renta', ['54'], 'gasto');

  const utilidadBruta = ingresos.total - costos.total;
  const utilidadOperacional = utilidadBruta - gastosAdmin.total - gastosVentas.total;
  const utilidadAntesDeImpuestos = utilidadOperacional + otrosIngresos.total - otrosGastos.total;
  return {
    desde: rango.desde, hasta: rango.hasta,
    secciones: [ingresos, costos, gastosAdmin, gastosVentas, otrosIngresos, otrosGastos, renta],
    utilidadBruta, utilidadOperacional, utilidadAntesDeImpuestos, utilidadNeta: utilidadAntesDeImpuestos - renta.total,
  };
}
