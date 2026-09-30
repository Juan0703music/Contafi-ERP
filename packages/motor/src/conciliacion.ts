import { diasEntre, type Centavos, type FechaISO } from '@contafi/shared';

/** Movimiento del extracto bancario: valor positivo = entra al banco; negativo = sale. */
export interface MovimientoBanco {
  id: string;
  fecha: FechaISO;
  descripcion: string;
  valor: Centavos;
}

/** Movimiento en libros sobre la cuenta del banco: débito − crédito (positivo = entra). */
export interface MovimientoLibro {
  id: string;
  fecha: FechaISO;
  concepto: string;
  valor: Centavos;
}

export interface Pareja {
  banco: string;
  libro: string;
  diasDiferencia: number;
}

/**
 * Conciliación asistida: empareja uno a uno movimientos del extracto y de libros con el MISMO valor y
 * fechas cercanas (el banco suele registrar días después). Da prioridad a las parejas más cercanas en
 * fecha; nunca usa un movimiento dos veces. El contador revisa y confirma.
 */
export function sugerirConciliacion(
  banco: readonly MovimientoBanco[], libros: readonly MovimientoLibro[],
  opciones: { toleranciaDias?: number; yaConciliadosBanco?: ReadonlySet<string>; yaConciliadosLibro?: ReadonlySet<string> } = {},
): Pareja[] {
  const tolerancia = opciones.toleranciaDias ?? 5;
  const usadosBanco = new Set(opciones.yaConciliadosBanco ?? []);
  const usadosLibro = new Set(opciones.yaConciliadosLibro ?? []);
  // Todas las parejas posibles (mismo valor, dentro de la tolerancia), de la más cercana a la más lejana.
  // Tomarlas en ese orden evita que un movimiento se quede con una pareja lejana por llegar primero.
  const candidatas: Pareja[] = [];
  for (const b of banco) {
    if (usadosBanco.has(b.id)) continue;
    for (const l of libros) {
      if (usadosLibro.has(l.id) || l.valor !== b.valor) continue;
      const dias = Math.abs(diasEntre(l.fecha, b.fecha));
      if (dias <= tolerancia) candidatas.push({ banco: b.id, libro: l.id, diasDiferencia: dias });
    }
  }
  const fechaBanco = new Map(banco.map((b) => [b.id, b.fecha]));
  candidatas.sort((x, y) => x.diasDiferencia - y.diasDiferencia
    || fechaBanco.get(x.banco)!.localeCompare(fechaBanco.get(y.banco)!) || x.banco.localeCompare(y.banco) || x.libro.localeCompare(y.libro));
  const parejas: Pareja[] = [];
  for (const c of candidatas) {
    if (usadosBanco.has(c.banco) || usadosLibro.has(c.libro)) continue;
    usadosBanco.add(c.banco);
    usadosLibro.add(c.libro);
    parejas.push(c);
  }
  return parejas.sort((x, y) => fechaBanco.get(x.banco)!.localeCompare(fechaBanco.get(y.banco)!) || x.banco.localeCompare(y.banco));
}

export interface ResumenConciliacion {
  saldoLibros: Centavos;
  saldoExtracto: Centavos;
  /** En el banco y no en libros (cargos, intereses, consignaciones sin registrar). */
  bancoSinRegistrar: Centavos;
  /** En libros y no en el banco (cheques no cobrados, consignaciones en tránsito). */
  librosEnTransito: Centavos;
  /** Debe ser cero cuando todo está explicado. */
  diferencia: Centavos;
}

/** saldo extracto = saldo libros − partidas de libros en tránsito + partidas del banco sin registrar. */
export function resumenConciliacion(
  saldoLibros: Centavos, saldoExtracto: Centavos,
  bancoPendientes: readonly MovimientoBanco[], librosPendientes: readonly MovimientoLibro[],
): ResumenConciliacion {
  const bancoSinRegistrar = bancoPendientes.reduce((s, b) => s + b.valor, 0n);
  const librosEnTransito = librosPendientes.reduce((s, l) => s + l.valor, 0n);
  return {
    saldoLibros, saldoExtracto, bancoSinRegistrar, librosEnTransito,
    diferencia: saldoExtracto - (saldoLibros - librosEnTransito + bancoSinRegistrar),
  };
}
