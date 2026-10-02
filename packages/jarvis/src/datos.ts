import { formatoCOP, hoyBogota, type Centavos, type FechaISO } from '@contafi/shared';
import type { Comprobante, Cuenta, Vencimiento } from '@contafi/motor';
import {
  comprobantesParaReportes, cuentasLocales, estadoSincronizacion, productosLocales, tercerosLocales, vencimientosLocales,
  type BaseLocal, type EmpresaLocal, type EstadoSincronizacion, type ProductoLocal, type TerceroLocal,
} from '@contafi/local';

export interface ContextoJarvis {
  base: BaseLocal;
  empresa: EmpresaLocal;
  /** Fecha de hoy en Colombia (se puede fijar en pruebas). */
  hoy?: FechaISO;
}

export interface DatosEmpresa {
  hoy: FechaISO;
  cuentas: Cuenta[];
  nombresCuenta: Map<string, string>;
  comprobantes: Comprobante[];
  terceros: TerceroLocal[];
  nombresTercero: Map<string, string>;
  sync: EstadoSincronizacion;
  /** "AAAA-MM" de los períodos cerrados. */
  periodosCerrados: Set<string>;
  productos: ProductoLocal[];
  /** Vencimientos de los próximos 45 días (calendario tributario cargado y obligaciones de la empresa). */
  vencimientos: Vencimiento[];
}

/** Carga una sola vez los datos locales de la empresa para responder una pregunta. */
export async function cargarDatos(ctx: ContextoJarvis): Promise<DatosEmpresa> {
  const hoy = ctx.hoy ?? hoyBogota();
  const [cuentas, comprobantes, terceros, sync, cerrados, productos, vencimientos] = await Promise.all([
    cuentasLocales(ctx.base, ctx.empresa.id),
    // Incluye lo pendiente de sincronizar: Jarvis lo advierte como provisional.
    comprobantesParaReportes(ctx.base, ctx.empresa.id, { incluirPendientes: true }),
    tercerosLocales(ctx.base, ctx.empresa.id),
    estadoSincronizacion(ctx.base, ctx.empresa.id),
    ctx.base.consultar<{ p: string }>(`select printf('%04d-%02d', anio, mes) as p from periodos where empresa_id = ? and estado = 'cerrado'`, [ctx.empresa.id]),
    productosLocales(ctx.base, ctx.empresa.id),
    vencimientosLocales(ctx.base, ctx.empresa.id, hoy, 45),
  ]);
  return {
    hoy, cuentas, comprobantes, terceros, sync, periodosCerrados: new Set(cerrados.map((x) => x.p)), productos, vencimientos,
    nombresCuenta: new Map(cuentas.map((c) => [c.codigo, c.nombre])),
    nombresTercero: new Map(terceros.map((t) => [t.id, t.nombre])),
  };
}

/** Monto como lo verá el usuario: "$ 1.234.567" (con centavos solo si los tiene). */
export function dinero(c: Centavos): string {
  return formatoCOP(c, { decimales: c % 100n !== 0n });
}

/**
 * Convierte la respuesta de una herramienta a JSON para el modelo: cada bigint (centavos) se vuelve
 * texto con formato de pesos y se registra en `cifras`, para verificar después la respuesta de la IA.
 */
export function serializar(valor: unknown, cifras: Set<bigint>): unknown {
  if (typeof valor === 'bigint') {
    cifras.add(valor);
    cifras.add(valor < 0n ? -valor : valor);
    return dinero(valor);
  }
  if (Array.isArray(valor)) return valor.map((v) => serializar(v, cifras));
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, serializar(v, cifras)]));
  }
  return valor;
}

/** Rango por defecto: del 1 de enero al día de hoy. */
export function rangoAnio(hoy: FechaISO, desde?: string, hasta?: string): { desde: FechaISO; hasta: FechaISO } {
  return { desde: desde || `${hoy.slice(0, 4)}-01-01`, hasta: hasta || hoy };
}

/** Bimestre de IVA que contiene la fecha (enero-febrero, marzo-abril...). */
export function bimestre(fecha: FechaISO): { desde: FechaISO; hasta: FechaISO } {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const inicio = mes % 2 === 1 ? mes : mes - 1;
  const fin = inicio + 1;
  const ultimo = new Date(Date.UTC(anio, fin, 0)).getUTCDate();
  return { desde: `${anio}-${String(inicio).padStart(2, '0')}-01`, hasta: `${anio}-${String(fin).padStart(2, '0')}-${ultimo}` };
}
