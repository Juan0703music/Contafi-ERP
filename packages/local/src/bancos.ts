import { esFechaValida, leerMontoUsuario, type Centavos, type FechaISO } from '@contafi/shared';
import {
  auxiliar, resumenConciliacion, sugerirConciliacion,
  type Linea, type MovimientoBanco, type MovimientoLibro, type ResumenConciliacion,
} from '@contafi/motor';
import { s, type BaseLocal } from './base.ts';
import { ErrorLocal, comprobantesParaReportes, crearComprobante } from './contabilidad.ts';

// ------------------------------------------------------------------ lectura del extracto

export interface LecturaExtracto {
  movimientos: { fecha: FechaISO; descripcion: string; referencia: string | null; valor: Centavos }[];
  errores: string[];
}

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function leerFecha(t: string): FechaISO | null {
  const x = t.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(x);
  const f = m ? `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
    : (m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(x)) ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
  return f && esFechaValida(f) ? f : null;
}

function leerValor(t: string): Centavos | null {
  const x = t.trim();
  const parentesis = /^\((.*)\)$/.exec(x); // (1.234,56) = negativo, como lo exportan algunos bancos
  const v = leerMontoUsuario(parentesis ? parentesis[1]! : x || '0');
  return v === null ? null : parentesis ? -v : v;
}

/**
 * Lee el extracto en CSV que exportan los bancos. Reconoce el encabezado por nombre:
 * fecha; descripción/concepto/detalle; referencia/documento; y un valor con signo, o columnas
 * separadas de débito/retiro y crédito/consignación. Separador ";" o ",".
 */
export function leerExtracto(texto: string): LecturaExtracto {
  const renglones = texto.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim());
  const sep = (renglones[0] ?? '').includes(';') ? ';' : ',';
  const cabecera = (renglones[0] ?? '').split(sep).map(normalizar);
  const col = (...nombres: string[]) => cabecera.findIndex((c) => nombres.some((n) => c.includes(n)));
  const iFecha = col('fecha');
  const iDesc = col('descrip', 'concepto', 'detalle');
  const iRef = col('referencia', 'documento', 'numero');
  const iValor = col('valor', 'monto', 'importe');
  const iDeb = col('debito', 'retiro', 'cargo', 'egreso');
  const iCred = col('credito', 'consignacion', 'abono', 'deposito', 'ingreso');
  const errores: string[] = [];
  if (iFecha < 0 || (iValor < 0 && (iDeb < 0 || iCred < 0))) {
    return { movimientos: [], errores: ['No se reconoce el formato: el archivo debe tener columnas de fecha y de valor (o de débito y crédito).'] };
  }
  const movimientos: LecturaExtracto['movimientos'] = [];
  renglones.slice(1).forEach((r, i) => {
    const c = r.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const n = i + 2;
    const fecha = leerFecha(c[iFecha] ?? '');
    if (!fecha) { errores.push(`Fila ${n}: fecha inválida "${c[iFecha] ?? ''}".`); return; }
    let valor: Centavos | null;
    if (iValor >= 0) valor = leerValor(c[iValor] ?? '');
    else {
      const deb = leerValor(c[iDeb] ?? '');
      const cred = leerValor(c[iCred] ?? '');
      valor = deb === null || cred === null ? null : (cred < 0n ? -cred : cred) - (deb < 0n ? -deb : deb);
    }
    if (valor === null) { errores.push(`Fila ${n}: valor inválido.`); return; }
    if (valor === 0n) return;
    movimientos.push({ fecha, descripcion: (iDesc >= 0 ? c[iDesc] : '') || 'Sin descripción', referencia: iRef >= 0 ? c[iRef] || null : null, valor });
  });
  return { movimientos, errores };
}

// ------------------------------------------------------------------ extractos y conciliación

/** Período por defecto del extracto: del primer día del mes de su primer movimiento a la última fecha. */
export function periodoExtracto(lectura: LecturaExtracto): { desde: FechaISO; hasta: FechaISO } {
  const fechas = lectura.movimientos.map((m) => m.fecha).sort();
  return { desde: `${fechas[0]!.slice(0, 7)}-01`, hasta: fechas[fechas.length - 1]! };
}

export async function guardarExtracto(
  base: BaseLocal, empresa: string, cuenta: string, archivo: string, lectura: LecturaExtracto, saldoFinal: Centavos,
  periodo: { desde: FechaISO; hasta: FechaISO } = periodoExtracto(lectura),
): Promise<string> {
  if (!lectura.movimientos.length) throw new ErrorLocal('DATOS_INVALIDOS', 'El extracto no tiene movimientos.');
  if (lectura.movimientos.some((m) => m.fecha < periodo.desde || m.fecha > periodo.hasta)) {
    throw new ErrorLocal('DATOS_INVALIDOS', 'Hay movimientos del extracto fuera del período indicado.');
  }
  const id = globalThis.crypto.randomUUID();
  await base.lote([
    s(`insert into extractos (id, empresa_id, cuenta, archivo, desde, hasta, saldo_final, importado_en) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, empresa, cuenta, archivo, periodo.desde, periodo.hasta, saldoFinal, new Date().toISOString()),
    ...lectura.movimientos.map((m) => s(
      `insert into lineas_extracto (id, extracto_id, fecha, descripcion, referencia, valor) values (?, ?, ?, ?, ?, ?)`,
      globalThis.crypto.randomUUID(), id, m.fecha, m.descripcion, m.referencia, m.valor)),
  ]);
  return id;
}

export interface Extracto {
  id: string;
  cuenta: string;
  archivo: string;
  desde: FechaISO;
  hasta: FechaISO;
  saldoFinal: Centavos;
}

export async function extractos(base: BaseLocal, empresa: string): Promise<Extracto[]> {
  const filas = await base.consultar<Record<string, string>>(
    `select id, cuenta, archivo, desde, hasta, cast(saldo_final as text) as saldo from extractos where empresa_id = ? order by hasta desc`, [empresa]);
  return filas.map((f) => ({ id: f['id']!, cuenta: f['cuenta']!, archivo: f['archivo']!, desde: f['desde']!, hasta: f['hasta']!, saldoFinal: BigInt(f['saldo']!) }));
}

export interface EstadoConciliacion {
  extracto: Extracto;
  banco: (MovimientoBanco & { conciliadoCon: string | null })[];
  libros: (MovimientoLibro & { conciliadoCon: string | null })[];
  resumen: ResumenConciliacion;
}

/** Movimientos de libros de la cuenta del banco en el período del extracto (incluye lo pendiente de sincronizar). */
async function movimientosLibros(base: BaseLocal, empresa: string, cuenta: string, desde: FechaISO, hasta: FechaISO) {
  const cs = await comprobantesParaReportes(base, empresa, { incluirPendientes: true });
  const movs: MovimientoLibro[] = [];
  for (const c of cs) {
    if (c.fecha < desde || c.fecha > hasta) continue;
    c.lineas.forEach((l, i) => {
      if (l.cuenta === cuenta) movs.push({ id: `${c.id}:${i + 1}`, fecha: c.fecha, concepto: l.nota ?? c.concepto, valor: l.debito - l.credito });
    });
  }
  const saldo = auxiliar(cs, cuenta, { hasta }).saldoFinal;
  return { movs, saldo };
}

export async function estadoConciliacion(base: BaseLocal, empresa: string, extractoId: string): Promise<EstadoConciliacion> {
  const extracto = (await extractos(base, empresa)).find((e) => e.id === extractoId);
  if (!extracto) throw new ErrorLocal('NO_EXISTE', 'El extracto no existe.');
  const lineas = await base.consultar<Record<string, string | null>>(
    `select l.id, l.fecha, l.descripcion, cast(l.valor as text) as valor, c.movimiento_libro
       from lineas_extracto l left join conciliaciones c on c.linea_extracto_id = l.id
      where l.extracto_id = ? order by l.fecha, l.id`, [extractoId]);
  const banco = lineas.map((l) => ({ id: l['id']!, fecha: l['fecha']!, descripcion: l['descripcion']!, valor: BigInt(l['valor']!), conciliadoCon: l['movimiento_libro'] ?? null }));
  const porLibro = new Map(banco.filter((b) => b.conciliadoCon).map((b) => [b.conciliadoCon!, b.id]));
  const { movs, saldo } = await movimientosLibros(base, empresa, extracto.cuenta, extracto.desde, extracto.hasta);
  const libros = movs.map((m) => ({ ...m, conciliadoCon: porLibro.get(m.id) ?? null }));
  const resumen = resumenConciliacion(saldo, extracto.saldoFinal, banco.filter((b) => !b.conciliadoCon), libros.filter((l) => !l.conciliadoCon));
  return { extracto, banco, libros, resumen };
}

/** Aplica las parejas sugeridas por el motor (mismo valor, fecha cercana). Devuelve cuántas concilió. */
export async function conciliarAutomaticamente(base: BaseLocal, empresa: string, extractoId: string, toleranciaDias = 5): Promise<number> {
  const e = await estadoConciliacion(base, empresa, extractoId);
  const parejas = sugerirConciliacion(e.banco, e.libros, {
    toleranciaDias,
    yaConciliadosBanco: new Set(e.banco.filter((b) => b.conciliadoCon).map((b) => b.id)),
    yaConciliadosLibro: new Set(e.libros.filter((l) => l.conciliadoCon).map((l) => l.id)),
  });
  const t = new Date().toISOString();
  if (parejas.length) {
    await base.lote(parejas.map((p) => s('insert into conciliaciones (linea_extracto_id, movimiento_libro, conciliado_en) values (?, ?, ?)', p.banco, p.libro, t)));
  }
  return parejas.length;
}

export async function conciliar(base: BaseLocal, lineaExtracto: string, movimientoLibro: string): Promise<void> {
  await base.lote([s('insert into conciliaciones (linea_extracto_id, movimiento_libro, conciliado_en) values (?, ?, ?)', lineaExtracto, movimientoLibro, new Date().toISOString())]);
}

export async function desconciliar(base: BaseLocal, lineaExtracto: string): Promise<void> {
  await base.lote([s('delete from conciliaciones where linea_extracto_id = ?', lineaExtracto)]);
}

/**
 * Registra en libros un movimiento que solo está en el banco (comisión, 4x1000, intereses) y lo deja
 * conciliado, todo en una transacción. `contrapartida` es la cuenta del gasto o ingreso (p. ej. 530505).
 */
export async function registrarDesdeExtracto(
  base: BaseLocal, empresa: string, extractoId: string, lineaExtracto: string, contrapartida: string, terceroId: string | null = null,
): Promise<{ id: string; numeroLocal: string }> {
  const e = await estadoConciliacion(base, empresa, extractoId);
  const b = e.banco.find((x) => x.id === lineaExtracto);
  if (!b) throw new ErrorLocal('NO_EXISTE', 'El movimiento del extracto no existe.');
  if (b.conciliadoCon) throw new ErrorLocal('YA_CONCILIADO', 'Ese movimiento ya está conciliado.');
  const valor = b.valor < 0n ? -b.valor : b.valor;
  const banco: Linea = { cuenta: e.extracto.cuenta, debito: b.valor > 0n ? valor : 0n, credito: b.valor < 0n ? valor : 0n, nota: b.descripcion };
  const otra: Linea = { cuenta: contrapartida, terceroId, debito: b.valor < 0n ? valor : 0n, credito: b.valor > 0n ? valor : 0n, nota: b.descripcion };
  return crearComprobante(base, empresa,
    { tipo: b.valor < 0n ? 'CE' : 'RC', fecha: b.fecha, concepto: `Extracto: ${b.descripcion}`, origen: 'tesoreria', lineas: [banco, otra] },
    { extra: (id) => [s('insert into conciliaciones (linea_extracto_id, movimiento_libro, conciliado_en) values (?, ?, ?)', lineaExtracto, `${id}:1`, new Date().toISOString())] });
}
