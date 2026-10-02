import { esFechaValida, type FechaISO } from '@contafi/shared';
import {
  antiguedadSaldos, auxiliar, balanceGeneral, estadoResultados, estadoResultadosDetallado, kardex, movimientosPorCuenta,
} from '@contafi/motor';
import { bimestre, rangoAnio, type DatosEmpresa } from './datos.ts';
import { calcularAlertas } from './alertas.ts';

/**
 * Herramientas de solo lectura que el modelo puede llamar (sección 12.3). Toda cifra que ve el usuario
 * sale de aquí, calculada por el motor; el modelo solo elige la herramienta y explica el resultado.
 */
export interface Herramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, { type: 'string' | 'integer'; description: string }>;
  requeridos?: string[];
  ejecutar: (args: Record<string, unknown>, d: DatosEmpresa) => unknown;
}

const fecha = (v: unknown): FechaISO | undefined => (typeof v === 'string' && esFechaValida(v) ? v : undefined);
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const entero = (v: unknown, def: number, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
};

/** Acepta un código PUC ("1110") o un nombre ("bancos"): devuelve el código o las coincidencias. */
function resolverCuenta(entrada: string, d: DatosEmpresa): { codigo: string; nombre: string } | { opciones: string[] } {
  const e = entrada.trim();
  if (/^\d{1,10}$/.test(e)) return { codigo: e, nombre: d.nombresCuenta.get(e) ?? '(cuenta no registrada)' };
  const q = e.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const coinciden = d.cuentas.filter((c) => c.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  // Se prefiere la cuenta de mayor nivel (la más general) que coincida.
  coinciden.sort((a, b) => a.codigo.length - b.codigo.length || a.codigo.localeCompare(b.codigo));
  if (coinciden.length === 0) return { opciones: [] };
  const c = coinciden[0]!;
  return { codigo: c.codigo, nombre: c.nombre };
}

const naturalezaDe = (codigo: string) => (['1', '5', '6', '7'].includes(codigo[0]!) ? 'D' : 'C');

function nombreTercero(id: string, d: DatosEmpresa) {
  return d.nombresTercero.get(id) ?? '(tercero)';
}

function antiguedad(d: DatosEmpresa, prefijo: string, lado: 'D' | 'C', corte: FechaISO) {
  const r = antiguedadSaldos(d.comprobantes, prefijo, lado, corte).filter((x) => x.saldo > 0n);
  const total = r.reduce((s, x) => s + x.saldo, 0n);
  return {
    fecha_corte: corte,
    total,
    hasta_30_dias: r.reduce((s, x) => s + x.rangos.r0_30, 0n),
    de_31_a_60_dias: r.reduce((s, x) => s + x.rangos.r31_60, 0n),
    de_61_a_90_dias: r.reduce((s, x) => s + x.rangos.r61_90, 0n),
    mas_de_90_dias: r.reduce((s, x) => s + x.rangos.mas90, 0n),
    terceros: r.slice(0, 8).map((x) => ({
      tercero: nombreTercero(x.terceroId, d), saldo: x.saldo,
      mas_antigua_dias: x.partidas[0]?.dias ?? 0,
    })),
  };
}

export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: 'saldo_cuenta',
    descripcion: 'Saldo de una cuenta del PUC (por código o por nombre, p. ej. "1110" o "bancos") a una fecha. Para caja y bancos juntos use "11".',
    parametros: {
      cuenta: { type: 'string', description: 'Código PUC (1, 2, 4 o 6 dígitos) o nombre de la cuenta' },
      fecha: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' },
    },
    requeridos: ['cuenta'],
    ejecutar: (a, d) => {
      const c = resolverCuenta(texto(a['cuenta']), d);
      if ('opciones' in c) return { error: `No encontré una cuenta llamada "${texto(a['cuenta'])}".` };
      const corte = fecha(a['fecha']) ?? d.hoy;
      const s = auxiliar(d.comprobantes, c.codigo, { hasta: corte }).saldoFinal;
      return { cuenta: c.codigo, nombre: c.nombre, fecha_corte: corte, saldo: naturalezaDe(c.codigo) === 'D' ? s : -s };
    },
  },
  {
    nombre: 'movimientos_cuenta',
    descripcion: 'Últimos movimientos de una cuenta del PUC en un rango de fechas.',
    parametros: {
      cuenta: { type: 'string', description: 'Código PUC o nombre de la cuenta' },
      desde: { type: 'string', description: 'AAAA-MM-DD (por defecto 1 de enero)' },
      hasta: { type: 'string', description: 'AAAA-MM-DD (por defecto hoy)' },
      limite: { type: 'integer', description: 'Cuántos movimientos mostrar (por defecto 5, máximo 20)' },
    },
    requeridos: ['cuenta'],
    ejecutar: (a, d) => {
      const c = resolverCuenta(texto(a['cuenta']), d);
      if ('opciones' in c) return { error: `No encontré una cuenta llamada "${texto(a['cuenta'])}".` };
      const r = rangoAnio(d.hoy, fecha(a['desde']), fecha(a['hasta']));
      const aux = auxiliar(d.comprobantes, c.codigo, r);
      // Los totales los da el motor: así el modelo no tiene que sumar (y no inventa cifras).
      return {
        cuenta: c.codigo, nombre: c.nombre, ...r,
        cantidad_de_movimientos: aux.filas.length,
        suma_debitos_del_periodo: aux.filas.reduce((x, f) => x + f.debito, 0n),
        suma_creditos_del_periodo: aux.filas.reduce((x, f) => x + f.credito, 0n),
        saldo_inicial: aux.saldoInicial, saldo_final: aux.saldoFinal,
        ultimos_movimientos: aux.filas.slice(-entero(a['limite'], 5, 20)).map((f) => ({
          fecha: f.fecha, comprobante: f.numero, concepto: f.concepto, debito: f.debito, credito: f.credito,
        })),
      };
    },
  },
  {
    nombre: 'cartera_por_edades',
    descripcion: 'Cuánto deben los clientes (cartera, cuenta 1305) y desde hace cuántos días, por tercero.',
    parametros: { fecha: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' } },
    ejecutar: (a, d) => antiguedad(d, '1305', 'D', fecha(a['fecha']) ?? d.hoy),
  },
  {
    nombre: 'cuentas_por_pagar',
    descripcion: 'Cuánto se les debe a los proveedores (cuenta 2205) y desde hace cuántos días, por tercero.',
    parametros: { fecha: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' } },
    ejecutar: (a, d) => antiguedad(d, '2205', 'C', fecha(a['fecha']) ?? d.hoy),
  },
  {
    nombre: 'estado_resultados',
    descripcion: 'Ingresos, costos, gastos y utilidad (o pérdida) en un período.',
    parametros: {
      desde: { type: 'string', description: 'AAAA-MM-DD (por defecto 1 de enero del año actual)' },
      hasta: { type: 'string', description: 'AAAA-MM-DD (por defecto hoy)' },
    },
    ejecutar: (a, d) => {
      const r = rangoAnio(d.hoy, fecha(a['desde']), fecha(a['hasta']));
      const er = estadoResultados(d.comprobantes, r);
      return {
        ...r, ingresos_operacionales: er.ingresosOperacionales, costo_de_ventas: er.costos, utilidad_bruta: er.utilidadBruta,
        gastos_operacionales: er.gastosOperacionales, otros_ingresos: er.ingresosNoOperacionales, otros_gastos: er.gastosNoOperacionales,
        impuesto_renta: er.impuestoRenta, utilidad_neta: er.utilidadNeta, resultado: er.utilidadNeta < 0n ? 'pérdida' : 'utilidad',
      };
    },
  },
  {
    nombre: 'balance_general',
    descripcion: 'Total de activos, pasivos y patrimonio a una fecha.',
    parametros: { fecha: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' } },
    ejecutar: (a, d) => {
      const corte = fecha(a['fecha']) ?? d.hoy;
      const bg = balanceGeneral(d.comprobantes, corte);
      return {
        fecha_corte: corte, activo: bg.activo, pasivo: bg.pasivo,
        patrimonio: bg.patrimonio + bg.resultadoDelEjercicio, resultado_del_ejercicio: bg.resultadoDelEjercicio,
        cuadra: bg.cuadra,
      };
    },
  },
  {
    nombre: 'comparar_periodos',
    descripcion: 'Compara ingresos, gastos y utilidad entre dos períodos (p. ej. este mes contra el anterior).',
    parametros: {
      desde_a: { type: 'string', description: 'Inicio del primer período AAAA-MM-DD' },
      hasta_a: { type: 'string', description: 'Fin del primer período AAAA-MM-DD' },
      desde_b: { type: 'string', description: 'Inicio del segundo período AAAA-MM-DD' },
      hasta_b: { type: 'string', description: 'Fin del segundo período AAAA-MM-DD' },
    },
    requeridos: ['desde_a', 'hasta_a', 'desde_b', 'hasta_b'],
    ejecutar: (a, d) => {
      const pa = { desde: fecha(a['desde_a']), hasta: fecha(a['hasta_a']) };
      const pb = { desde: fecha(a['desde_b']), hasta: fecha(a['hasta_b']) };
      if (!pa.desde || !pa.hasta || !pb.desde || !pb.hasta) return { error: 'Faltan fechas válidas (AAAA-MM-DD) para los dos períodos.' };
      const ea = estadoResultados(d.comprobantes, pa);
      const eb = estadoResultados(d.comprobantes, pb);
      const fila = (x: typeof ea) => ({ ingresos: x.ingresosOperacionales + x.ingresosNoOperacionales, costos_y_gastos: x.costos + x.gastosOperacionales + x.gastosNoOperacionales + x.impuestoRenta, utilidad_neta: x.utilidadNeta });
      const A = fila(ea), B = fila(eb);
      return {
        periodo_a: { ...pa, ...A }, periodo_b: { ...pb, ...B },
        diferencia: { ingresos: B.ingresos - A.ingresos, costos_y_gastos: B.costos_y_gastos - A.costos_y_gastos, utilidad_neta: B.utilidad_neta - A.utilidad_neta },
      };
    },
  },
  {
    nombre: 'iva_periodo',
    descripcion: 'IVA generado, IVA descontable y saldo estimado a pagar de un período (por defecto el bimestre actual).',
    parametros: {
      desde: { type: 'string', description: 'AAAA-MM-DD' },
      hasta: { type: 'string', description: 'AAAA-MM-DD' },
    },
    ejecutar: (a, d) => {
      const b = bimestre(d.hoy);
      const r = { desde: fecha(a['desde']) ?? b.desde, hasta: fecha(a['hasta']) ?? b.hasta };
      const mov = movimientosPorCuenta(d.comprobantes, r);
      let generado = 0n, descontable = 0n;
      for (const [codigo, m] of mov) {
        if (codigo.startsWith('240805')) generado += m.credito - m.debito;
        if (codigo.startsWith('240810')) descontable += m.debito - m.credito;
      }
      return { ...r, iva_generado: generado, iva_descontable: descontable, saldo_a_pagar: generado - descontable, nota: 'Estimado con lo contabilizado; no reemplaza la declaración.' };
    },
  },
  {
    nombre: 'retenciones_periodo',
    descripcion: 'Retenciones practicadas por pagar (2365, 2367, 2368) y retenciones que le practicaron a la empresa (1355) en un período (por defecto el mes actual).',
    parametros: {
      desde: { type: 'string', description: 'AAAA-MM-DD' },
      hasta: { type: 'string', description: 'AAAA-MM-DD' },
    },
    ejecutar: (a, d) => {
      const r = { desde: fecha(a['desde']) ?? `${d.hoy.slice(0, 7)}-01`, hasta: fecha(a['hasta']) ?? d.hoy };
      const mov = movimientosPorCuenta(d.comprobantes, r);
      const practicadas: { cuenta: string; nombre: string; valor: bigint }[] = [];
      const aFavor: { cuenta: string; nombre: string; valor: bigint }[] = [];
      for (const [codigo, m] of [...mov].sort(([x], [y]) => x.localeCompare(y))) {
        if (/^236[578]/.test(codigo) && m.credito - m.debito !== 0n) practicadas.push({ cuenta: codigo, nombre: d.nombresCuenta.get(codigo) ?? codigo, valor: m.credito - m.debito });
        if (codigo.startsWith('1355') && m.debito - m.credito !== 0n) aFavor.push({ cuenta: codigo, nombre: d.nombresCuenta.get(codigo) ?? codigo, valor: m.debito - m.credito });
      }
      return {
        ...r, practicadas_por_pagar: practicadas, total_por_pagar: practicadas.reduce((s, x) => s + x.valor, 0n),
        que_nos_practicaron: aFavor, total_a_favor: aFavor.reduce((s, x) => s + x.valor, 0n),
      };
    },
  },
  {
    nombre: 'top_gastos',
    descripcion: 'Los gastos más altos por cuenta en un período.',
    parametros: {
      desde: { type: 'string', description: 'AAAA-MM-DD (por defecto 1 de enero)' },
      hasta: { type: 'string', description: 'AAAA-MM-DD (por defecto hoy)' },
      cantidad: { type: 'integer', description: 'Cuántos (máximo 10)' },
    },
    ejecutar: (a, d) => {
      const r = rangoAnio(d.hoy, fecha(a['desde']), fecha(a['hasta']));
      const er = estadoResultadosDetallado(d.cuentas, d.comprobantes, r);
      const gastos = er.secciones.filter((s) => s.naturaleza === 'gasto' && s.titulo !== 'Costo de ventas').flatMap((s) => s.renglones);
      gastos.sort((x, y) => (y.valor > x.valor ? 1 : y.valor < x.valor ? -1 : 0));
      return { ...r, gastos: gastos.slice(0, entero(a['cantidad'], 5, 10)).map((g) => ({ cuenta: g.codigo, nombre: g.nombre, valor: g.valor })) };
    },
  },
  {
    nombre: 'buscar_tercero',
    descripcion: 'Busca un cliente o proveedor por nombre o documento y muestra cuánto debe o se le debe.',
    parametros: { texto: { type: 'string', description: 'Nombre, NIT o cédula' } },
    requeridos: ['texto'],
    ejecutar: (a, d) => {
      const q = texto(a['texto']);
      if (!q) return { error: 'Indique un nombre o documento.' };
      const sinTilde = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const digitos = q.replace(/\D/g, '');
      // Por documento, o por palabras: todas las de 3 o más letras deben aparecer en el nombre.
      const palabras = sinTilde(q).split(/[\s.,]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
      const encontrados = d.terceros.filter((t) => (digitos.length >= 5 && t.numero.startsWith(digitos))
        || (palabras.length > 0 && palabras.every((w) => sinTilde(t.nombre).includes(w)))).slice(0, 5);
      return {
        terceros: encontrados.map((t) => ({
          nombre: t.nombre, documento: `${t.numero}${t.dv != null ? `-${t.dv}` : ''}`, tipos: t.tipos,
          nos_debe: auxiliar(d.comprobantes, '1305', { terceroId: t.id, hasta: d.hoy }).saldoFinal,
          le_debemos: -auxiliar(d.comprobantes, '2205', { terceroId: t.id, hasta: d.hoy }).saldoFinal,
        })),
      };
    },
  },
  {
    nombre: 'buscar_comprobante',
    descripcion: 'Busca comprobantes por número (p. ej. FV-000012) o por palabras del concepto.',
    parametros: { texto: { type: 'string', description: 'Número o palabras del concepto' } },
    requeridos: ['texto'],
    ejecutar: (a, d) => {
      const q = texto(a['texto']).toLowerCase();
      const sinTilde = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // Por número, o por palabras: todas las palabras de 4 o más letras deben aparecer en el concepto.
      const palabras = sinTilde(q).split(/\s+/).filter((w) => w.length >= 4);
      const r = d.comprobantes.filter((c) => (c.numero ?? '').toLowerCase().includes(q)
        || (palabras.length > 0 && palabras.every((w) => sinTilde(c.concepto).includes(w)))).slice(-8);
      return {
        comprobantes: r.map((c) => ({
          numero: c.numero ?? '(pendiente de número)', fecha: c.fecha, concepto: c.concepto,
          valor: c.lineas.reduce((s, l) => s + l.debito, 0n), estado: c.estado,
        })),
      };
    },
  },
  {
    nombre: 'inventario_bajo',
    descripcion: 'Productos con pocas existencias (o negativas) en el inventario.',
    parametros: { minimo: { type: 'integer', description: 'Cantidad mínima: se listan los que estén en o por debajo (por defecto 5)' } },
    ejecutar: (a, d) => {
      const minimo = BigInt(entero(a['minimo'], 5, 1_000_000)) * 1000n;
      const lista = d.productos.filter((p) => p.tipo === 'producto' && p.activo)
        .map((p) => ({ p, e: kardex(d.comprobantes, p.id).estado }))
        .filter((x) => x.e.cantidad <= minimo)
        .sort((x, y) => (x.e.cantidad < y.e.cantidad ? -1 : 1));
      return {
        productos: lista.slice(0, 15).map((x) => ({
          codigo: x.p.codigo, nombre: x.p.nombre, existencia: `${Number(x.e.cantidad) / 1000} ${x.p.unidad}`, valor: x.e.valor,
        })),
        total_productos_con_inventario: d.productos.filter((p) => p.tipo === 'producto').length,
      };
    },
  },
  {
    nombre: 'proximos_vencimientos',
    descripcion: 'Obligaciones tributarias que vencen pronto (declaraciones y pagos) según el calendario cargado y el NIT de la empresa.',
    parametros: { dias: { type: 'integer', description: 'Cuántos días hacia adelante (por defecto 30, máximo 45)' } },
    ejecutar: (a, d) => {
      const dias = entero(a['dias'], 30, 45);
      return {
        desde: d.hoy, dias,
        vencimientos: d.vencimientos.filter((v) => v.dias <= dias).map((v) => ({ obligacion: v.nombre, periodo: v.periodo, fecha: v.fecha, dias_restantes: v.dias })),
      };
    },
  },
  {
    nombre: 'alertas_empresa',
    descripcion: 'Lo que requiere atención: vencimientos tributarios, cartera vencida, cuentas por pagar viejas, IVA del bimestre, meses sin cerrar, rechazos, gastos inusuales.',
    parametros: {},
    ejecutar: (_a, d) => ({ alertas: calcularAlertas(d).map((x) => ({ nivel: x.nivel, titulo: x.titulo, detalle: x.detalle })) }),
  },
];

/** Formato de herramientas compatible con OpenAI / llama-server. */
export function definicionesOpenAI() {
  return HERRAMIENTAS.map((h) => ({
    type: 'function' as const,
    function: {
      name: h.nombre,
      description: h.descripcion,
      parameters: { type: 'object', properties: h.parametros, required: h.requeridos ?? [] },
    },
  }));
}
