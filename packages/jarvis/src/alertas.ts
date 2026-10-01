import { aCentavos, sumarDias, type Centavos } from '@contafi/shared';
import { antiguedadSaldos, movimientosPorCuenta, balanceGeneral } from '@contafi/motor';
import { bimestre, dinero, type DatosEmpresa } from './datos.ts';

export interface Alerta {
  id: string;
  nivel: 'alta' | 'media' | 'info';
  titulo: string;
  detalle: string;
  /** Pantalla de la app donde se atiende. */
  ruta: 'panel' | 'comprobantes' | 'cierres' | 'sincronizacion' | 'libros' | 'estados' | 'terceros';
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Umbral para considerar inusual un gasto: más del 50 % sobre su promedio y al menos $ 200.000 de diferencia. */
const MINIMO_GASTO_INUSUAL = aCentavos('200000');

/**
 * Alertas proactivas (sección 12.4). Las calculan REGLAS sobre los datos del motor, no la IA: así son
 * exactas y funcionan aunque el PC no tenga IA. La IA, si está disponible, solo redacta el resumen.
 */
export function calcularAlertas(d: DatosEmpresa): Alerta[] {
  const alertas: Alerta[] = [];
  const hoy = d.hoy;

  // Integridad y sincronización
  if (!balanceGeneral(d.comprobantes, hoy).cuadra) {
    alertas.push({ id: 'descuadre', nivel: 'alta', titulo: 'La ecuación contable no cuadra', detalle: 'Activo ≠ pasivo + patrimonio. Revise el balance de prueba.', ruta: 'libros' });
  }
  if (d.sync.rechazados + d.sync.tercerosConError) {
    alertas.push({ id: 'rechazados', nivel: 'alta', titulo: `${d.sync.rechazados + d.sync.tercerosConError} registro(s) rechazados por el servidor`, detalle: 'Corríjalos para que entren a los libros oficiales.', ruta: 'sincronizacion' });
  }
  if (d.sync.alerta) {
    alertas.push({ id: 'sin-sync', nivel: 'alta', titulo: d.sync.diasSinSincronizar === null ? 'Este equipo nunca ha sincronizado' : `${d.sync.diasSinSincronizar} días sin sincronizar`, detalle: `${d.sync.pendientes} registro(s) esperan número oficial.`, ruta: 'sincronizacion' });
  }
  if (d.sync.porAprobar) {
    alertas.push({ id: 'por-aprobar', nivel: 'media', titulo: `${d.sync.porAprobar} comprobante(s) esperan aprobación`, detalle: 'Un contador debe aprobarlos para que afecten los saldos oficiales.', ruta: 'comprobantes' });
  }

  // Cartera vencida (sin vencimiento por documento: se mide desde la fecha de la factura)
  const cartera = antiguedadSaldos(d.comprobantes, '1305', 'D', hoy).filter((x) => x.saldo > 0n);
  const sumar = (f: (x: (typeof cartera)[number]) => Centavos) => cartera.reduce((s, x) => s + f(x), 0n);
  const c90 = sumar((x) => x.rangos.mas90);
  const c60 = sumar((x) => x.rangos.r61_90);
  const c30 = sumar((x) => x.rangos.r31_60);
  if (c30 + c60 + c90 > 0n) {
    const peor = [...cartera].sort((a, b) => (b.partidas[0]?.dias ?? 0) - (a.partidas[0]?.dias ?? 0))[0]!;
    alertas.push({
      id: 'cartera', nivel: c90 > 0n ? 'alta' : 'media',
      titulo: `Cartera con más de 30 días: ${dinero(c30 + c60 + c90)}`,
      detalle: `31–60 días: ${dinero(c30)} · 61–90: ${dinero(c60)} · más de 90: ${dinero(c90)}. La más antigua: ${d.nombresTercero.get(peor.terceroId) ?? 'un cliente'} (${peor.partidas[0]?.dias ?? 0} días).`,
      ruta: 'terceros',
    });
  }

  // Proveedores: lo que se les debe hace más de 30 días
  const cxp = antiguedadSaldos(d.comprobantes, '2205', 'C', hoy).filter((x) => x.saldo > 0n);
  const cxpViejas = cxp.reduce((s, x) => s + x.rangos.r31_60 + x.rangos.r61_90 + x.rangos.mas90, 0n);
  if (cxpViejas > 0n) {
    alertas.push({ id: 'proveedores', nivel: 'media', titulo: `Cuentas por pagar con más de 30 días: ${dinero(cxpViejas)}`, detalle: `${cxp.length} proveedor(es) con saldo pendiente.`, ruta: 'terceros' });
  }

  // IVA estimado del bimestre en curso
  const b = bimestre(hoy);
  const movB = movimientosPorCuenta(d.comprobantes, b);
  let ivaGen = 0n, ivaDesc = 0n;
  for (const [codigo, m] of movB) {
    if (codigo.startsWith('240805')) ivaGen += m.credito - m.debito;
    if (codigo.startsWith('240810')) ivaDesc += m.debito - m.credito;
  }
  if (ivaGen !== 0n || ivaDesc !== 0n) {
    const saldo = ivaGen - ivaDesc;
    alertas.push({ id: 'iva', nivel: 'info', titulo: `IVA estimado del bimestre: ${dinero(saldo < 0n ? -saldo : saldo)} ${saldo < 0n ? 'a favor' : 'por pagar'}`, detalle: `Generado ${dinero(ivaGen)} − descontable ${dinero(ivaDesc)} (${b.desde} a ${b.hasta}).`, ruta: 'estados' });
  }

  // Meses ya terminados con movimiento y sin cerrar
  const anio = hoy.slice(0, 4);
  const mesActual = Number(hoy.slice(5, 7));
  const conMovimiento = new Set(d.comprobantes.filter((c) => c.fecha.startsWith(anio)).map((c) => Number(c.fecha.slice(5, 7))));
  const abiertos = [...conMovimiento].filter((m) => m < mesActual && !d.periodosCerrados.has(`${anio}-${String(m).padStart(2, '0')}`)).sort((a, b) => a - b);
  if (abiertos.length) {
    alertas.push({ id: 'periodos', nivel: abiertos.length >= 2 ? 'media' : 'info', titulo: `${abiertos.length} mes(es) terminados sin cerrar`, detalle: abiertos.map((m) => MESES[m - 1]).join(', '), ruta: 'cierres' });
  }

  // Gastos inusuales: el mes en curso contra el promedio de los 3 anteriores (solo meses con gasto)
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const actual = movimientosPorCuenta(d.comprobantes, { desde: inicioMes, hasta: hoy });
  const previos: Map<string, { debito: bigint; credito: bigint }>[] = [];
  let fin = sumarDias(inicioMes, -1);
  for (let i = 0; i < 3; i++) {
    const ini = `${fin.slice(0, 7)}-01`;
    previos.push(movimientosPorCuenta(d.comprobantes, { desde: ini, hasta: fin }));
    fin = sumarDias(ini, -1);
  }
  const porMayor = (mov: Map<string, { debito: bigint; credito: bigint }>) => {
    const r = new Map<string, bigint>();
    for (const [codigo, m] of mov) if (codigo.startsWith('5')) r.set(codigo.slice(0, 4), (r.get(codigo.slice(0, 4)) ?? 0n) + m.debito - m.credito);
    return r;
  };
  const ahora = porMayor(actual);
  const antes = previos.map(porMayor);
  for (const [cuenta, valor] of ahora) {
    const historicos = antes.map((m) => m.get(cuenta) ?? 0n).filter((v) => v > 0n);
    if (!historicos.length) continue;
    const promedio = historicos.reduce((s, v) => s + v, 0n) / BigInt(historicos.length);
    if (valor * 2n > promedio * 3n && valor - promedio >= MINIMO_GASTO_INUSUAL) {
      alertas.push({ id: `gasto-${cuenta}`, nivel: 'media', titulo: `Gasto inusual en ${d.nombresCuenta.get(cuenta) ?? cuenta}`, detalle: `Este mes: ${dinero(valor)}; promedio de meses anteriores: ${dinero(promedio)}.`, ruta: 'libros' });
    }
  }

  const orden = { alta: 0, media: 1, info: 2 };
  return alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

/** Resumen en texto, sin IA (la IA, si está, solo lo redacta mejor). */
export function resumenAlertas(alertas: Alerta[], nombre?: string): string {
  const saludo = nombre ? `Hola, ${nombre}.` : 'Hola.';
  if (!alertas.length) return `${saludo} Todo está al día: no hay alertas para esta empresa.`;
  const altas = alertas.filter((a) => a.nivel === 'alta').length;
  return `${saludo} Hay ${alertas.length} alerta(s)${altas ? `, ${altas} importante(s)` : ''}: ${alertas.map((a) => a.titulo).join('; ')}.`;
}
