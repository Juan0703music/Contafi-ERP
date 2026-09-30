import { leerMontoUsuario, limpiarNit, type FechaISO } from '@contafi/shared';
import { ErrorMotor, estadoResultados, lineasCierreAnual, type Cuenta, type Linea } from '@contafi/motor';
import { s, type BaseLocal } from './base.ts';
import { comprobantesParaReportes, crearComprobante, cuentasLocales } from './contabilidad.ts';

// ------------------------------------------------------------------ períodos (regla 4)

export interface ResumenPeriodo {
  anio: number;
  mes: number;
  estado: 'abierto' | 'cerrado';
  comprobantes: number;
  /** Creados en este PC y aún sin número oficial: cerrar el mes los haría rechazar. */
  pendientes: number;
}

export async function resumenPeriodos(base: BaseLocal, empresa: string, anio: number): Promise<ResumenPeriodo[]> {
  const filas = await base.consultar<{ mes: number; total: number; pendientes: number }>(
    `select cast(substr(fecha, 6, 2) as integer) as mes, count(*) as total,
            sum(case when estado in ('pendiente_sync', 'por_aprobar') then 1 else 0 end) as pendientes
       from comprobantes where empresa_id = ? and substr(fecha, 1, 4) = ? and estado <> 'rechazado'
      group by mes`, [empresa, String(anio)]);
  const cerrados = new Set((await base.consultar<{ mes: number }>(
    `select mes from periodos where empresa_id = ? and anio = ? and estado = 'cerrado'`, [empresa, anio])).map((p) => Number(p.mes)));
  return Array.from({ length: 12 }, (_, i) => {
    const f = filas.find((x) => Number(x.mes) === i + 1);
    return { anio, mes: i + 1, estado: cerrados.has(i + 1) ? 'cerrado' : 'abierto', comprobantes: Number(f?.total ?? 0), pendientes: Number(f?.pendientes ?? 0) };
  });
}

/** Solo para el modo demostración: en la nube el período se cierra en el servidor y llega al sincronizar. */
export async function cambiarPeriodoLocal(base: BaseLocal, empresa: string, anio: number, mes: number, estado: 'abierto' | 'cerrado'): Promise<void> {
  await base.lote([s(`insert into periodos (empresa_id, anio, mes, estado) values (?, ?, ?, ?)
                      on conflict (empresa_id, anio, mes) do update set estado = excluded.estado`, empresa, anio, mes, estado)]);
}

// ------------------------------------------------------------------ cierre anual (regla 10)

export interface VistaCierreAnual {
  anio: number;
  lineas: Linea[];
  utilidadNeta: bigint;
  yaExiste: boolean;
  pendientes: number;
}

/** Calcula el cierre anual con lo oficialmente contabilizado (sin lo pendiente de sincronizar). */
export async function vistaCierreAnual(base: BaseLocal, empresa: string, anio: number): Promise<VistaCierreAnual> {
  const oficiales = await comprobantesParaReportes(base, empresa);
  const { lineas, utilidadNeta } = lineasCierreAnual(oficiales, anio);
  const [x] = await base.consultar<{ existe: number; pendientes: number }>(
    `select (select count(*) from comprobantes where empresa_id = ?1 and origen = 'cierre_anual' and substr(fecha, 1, 4) = ?2
               and estado not in ('anulado', 'rechazado')) as existe,
            (select count(*) from comprobantes where empresa_id = ?1 and substr(fecha, 1, 4) = ?2 and estado in ('pendiente_sync', 'por_aprobar')) as pendientes`,
    [empresa, String(anio)]);
  return { anio, lineas, utilidadNeta, yaExiste: Number(x?.existe ?? 0) > 0, pendientes: Number(x?.pendientes ?? 0) };
}

export async function generarCierreAnual(base: BaseLocal, empresa: string, anio: number): Promise<{ id: string; numeroLocal: string }> {
  const v = await vistaCierreAnual(base, empresa, anio);
  const problema = v.yaExiste ? `Ya existe un comprobante de cierre para ${anio}.`
    : v.pendientes > 0 ? `Hay ${v.pendientes} comprobante(s) de ${anio} sin número oficial. Sincronice antes de cerrar el año.`
      : v.lineas.length < 2 ? `No hay saldos en las cuentas de resultado de ${anio}.` : null;
  if (problema) throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: problema }]);
  // La clave es la misma en todos los PC (el servidor no duplica el cierre del año) y cambia si el
  // cierre anterior se anuló (para poder generarlo de nuevo).
  const [{ anulados }] = await base.consultar<{ anulados: number }>(
    `select count(*) as anulados from comprobantes where empresa_id = ? and origen = 'cierre_anual' and substr(fecha, 1, 4) = ? and estado = 'anulado'`,
    [empresa, String(anio)]) as [{ anulados: number }];
  return crearComprobante(base, empresa, {
    tipo: 'CC', fecha: `${anio}-12-31`, origen: 'cierre_anual', lineas: v.lineas,
    concepto: `Cierre del ejercicio ${anio}: ${v.utilidadNeta >= 0n ? 'utilidad' : 'pérdida'} a resultados del ejercicio`,
  }, { clave: `cierre-anual:${empresa}:${anio}:${Number(anulados)}` });
}

/** Utilidad del año con lo oficial, para mostrar antes de generar el cierre. */
export async function utilidadDelAnio(base: BaseLocal, empresa: string, anio: number): Promise<bigint> {
  return estadoResultados(await comprobantesParaReportes(base, empresa), { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }).utilidadNeta;
}

// ------------------------------------------------------------------ saldos iniciales

export const PLANTILLA_SALDOS = [
  'cuenta;nit_tercero;debito;credito;nota',
  '111005;;50.000.000;0;Saldo en bancos',
  '130505;830945221;12.500.000;0;Cartera de El Roble',
  '310505;;0;62.500.000;Capital',
].join('\r\n');

export interface LecturaSaldos {
  lineas: Linea[];
  errores: string[];
  totalDebitos: bigint;
  totalCreditos: bigint;
}

/**
 * Lee el CSV de saldos iniciales (separado por ";" o ",", como lo guarda Excel en español o en inglés).
 * Valida cuentas auxiliares, terceros por NIT y montos; la partida doble la valida luego el motor.
 */
export async function leerSaldosIniciales(base: BaseLocal, empresa: string, texto: string): Promise<LecturaSaldos> {
  const cuentas = new Map((await cuentasLocales(base, empresa)).map((c): [string, Cuenta] => [c.codigo, c]));
  const terceros = new Map((await base.consultar<{ id: string; numero: string }>('select id, numero from terceros where empresa_id = ?', [empresa]))
    .map((t) => [t.numero, t.id]));
  const renglones = texto.replace(/^﻿/, '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const sep = (renglones[0] ?? '').includes(';') ? ';' : ',';
  const errores: string[] = [];
  const lineas: Linea[] = [];
  renglones.forEach((renglon, i) => {
    const n = i + 1;
    const [cuenta = '', nit = '', deb = '', cred = '', ...nota] = renglon.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && !/^\d/.test(cuenta)) return; // encabezado
    const c = cuentas.get(cuenta);
    if (!c) { errores.push(`Fila ${n}: la cuenta "${cuenta}" no existe.`); return; }
    if (!c.aceptaMovimiento) { errores.push(`Fila ${n}: la cuenta ${cuenta} no es auxiliar.`); return; }
    let terceroId: string | null = null;
    if (nit) {
      terceroId = terceros.get(limpiarNit(nit)) ?? null;
      if (!terceroId) { errores.push(`Fila ${n}: no existe un tercero con documento ${nit}. Créelo primero.`); return; }
    } else if (c.exigeTercero) { errores.push(`Fila ${n}: la cuenta ${cuenta} exige tercero.`); return; }
    const debito = leerMontoUsuario(deb || '0');
    const credito = leerMontoUsuario(cred || '0');
    if (debito === null || credito === null || debito < 0n || credito < 0n) { errores.push(`Fila ${n}: valores inválidos ("${deb}", "${cred}").`); return; }
    if (debito === 0n && credito === 0n) return; // fila en cero: se ignora
    lineas.push({ cuenta, terceroId, debito, credito, nota: nota.join(sep) || null });
  });
  return {
    lineas, errores,
    totalDebitos: lineas.reduce((s, l) => s + l.debito, 0n),
    totalCreditos: lineas.reduce((s, l) => s + l.credito, 0n),
  };
}

export async function crearSaldosIniciales(base: BaseLocal, empresa: string, fecha: FechaISO, lineas: Linea[]): Promise<{ id: string; numeroLocal: string }> {
  return crearComprobante(base, empresa, { tipo: 'SI', fecha, concepto: 'Saldos iniciales', origen: 'saldos_iniciales', lineas });
}
