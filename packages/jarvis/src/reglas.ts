import { sumarDias, type FechaISO } from '@contafi/shared';
import { cargarDatos, dinero, type ContextoJarvis, type DatosEmpresa } from './datos.ts';
import { ejecutarHerramienta, verificarCifras, type RespuestaJarvis } from './asistente.ts';
import { calcularAlertas, resumenAlertas } from './alertas.ts';

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,]/g, ' ');

/** Rangos de fecha comunes en español: "este mes", "mes pasado", "este año", "año pasado". */
export function rangoDesdeTexto(t: string, hoy: FechaISO): { desde?: FechaISO; hasta?: FechaISO } {
  const n = normalizar(t);
  const anio = Number(hoy.slice(0, 4));
  if (/mes pasado|mes anterior/.test(n)) {
    const fin = sumarDias(`${hoy.slice(0, 7)}-01`, -1);
    return { desde: `${fin.slice(0, 7)}-01`, hasta: fin };
  }
  if (/este mes|del mes|en el mes/.test(n)) return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (/ano pasado|ano anterior/.test(n)) return { desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` };
  if (/este ano|del ano|en el ano|en lo que va/.test(n)) return { desde: `${anio}-01-01`, hasta: hoy };
  return {};
}

interface Intencion {
  herramienta: string;
  argumentos: (t: string, d: DatosEmpresa) => Record<string, unknown>;
  redactar: (r: Record<string, unknown>) => string;
}

const v = (x: unknown) => String(x);

const PALABRAS_VACIAS = /\b(cuanto|cuanta|nos|debe|deben|busca|buscar|el|la|los|las|al|del|de|proveedor|cliente|tercero|quien|es|con|nit|cedula|me|dime|muestrame|donde|esta|registrado|registrada|comprobante|que|un|una)\b/g;
/** Lo que queda de la pregunta al quitar palabras de relleno: el nombre buscado. */
const resto = (t: string) => normalizar(t).replace(PALABRAS_VACIAS, ' ').replace(/\s+/g, ' ').trim();

const INTENCIONES: [RegExp, Intencion][] = [
  [/\b[a-z]{2}-\d{3,6}\b|comprobante|donde esta registrad/, {
    herramienta: 'buscar_comprobante',
    argumentos: (t) => ({ texto: /\b([a-z]{2}-\d{3,6})\b/i.exec(t)?.[1]?.toUpperCase() ?? resto(t) }),
    redactar: (r) => {
      const c = r['comprobantes'] as { numero: string; fecha: string; concepto: string; valor: string }[];
      return c.length ? `Encontré: ${c.map((x) => `${x.numero} del ${x.fecha}, ${x.concepto}, por ${x.valor}`).join('; ')}.` : 'No encontré comprobantes con esos datos.';
    },
  }],
  [/movimiento/, {
    herramienta: 'movimientos_cuenta',
    argumentos: (t, d) => ({ cuenta: /\b(\d{2,10})\b/.exec(t)?.[1] ?? (/banco/.test(normalizar(t)) ? '1110' : '11'), ...rangoDesdeTexto(t, d.hoy) }),
    redactar: (r) => {
      const m = r['movimientos'] as { fecha: string; concepto: string; debito: string; credito: string }[];
      return m.length ? `Últimos movimientos de ${v(r['nombre'])}: ${m.slice(-5).map((x) => `${x.fecha} ${x.concepto} (débito ${x.debito}, crédito ${x.credito})`).join('; ')}.` : `La cuenta ${v(r['nombre'])} no tiene movimientos en ese período.`;
    },
  }],
  [/compar|comparad|contra el mes|frente al/, {
    herramienta: 'comparar_periodos',
    argumentos: (_t, d) => {
      const finPasado = sumarDias(`${d.hoy.slice(0, 7)}-01`, -1);
      return { desde_a: `${finPasado.slice(0, 7)}-01`, hasta_a: finPasado, desde_b: `${d.hoy.slice(0, 7)}-01`, hasta_b: d.hoy };
    },
    redactar: (r) => {
      const a = r['periodo_a'] as Record<string, string>, b = r['periodo_b'] as Record<string, string>;
      return `Mes anterior: ingresos ${a['ingresos']}, utilidad ${a['utilidad_neta']}. Mes actual: ingresos ${b['ingresos']}, utilidad ${b['utilidad_neta']}.`;
    },
  }],
  [/nos debe [a-z]|busca (el|la|al)? ?(proveedor|cliente|tercero)|tercero con|\bnit \d/, {
    herramienta: 'buscar_tercero',
    argumentos: (t) => ({ texto: /\b(\d{6,12})\b/.exec(t)?.[1] ?? resto(t) }),
    redactar: (r) => {
      const t = r['terceros'] as { nombre: string; documento: string; nos_debe: string; le_debemos: string }[];
      return t.length ? t.map((x) => `${x.nombre} (${x.documento}): nos debe ${x.nos_debe} y le debemos ${x.le_debemos}`).join('. ') + '.' : 'No encontré ese tercero.';
    },
  }],
  [/cuenta (\d{2,10})/, {
    herramienta: 'saldo_cuenta', argumentos: (t) => ({ cuenta: /cuenta (\d{2,10})/.exec(normalizar(t))![1] }),
    redactar: (r) => `El saldo de ${v(r['cuenta'])} ${v(r['nombre'])} al ${v(r['fecha_corte'])} es ${v(r['saldo'])}.`,
  }],
  [/\biva\b/, {
    herramienta: 'iva_periodo', argumentos: (t, d) => rangoDesdeTexto(t, d.hoy),
    redactar: (r) => `IVA del ${v(r['desde'])} al ${v(r['hasta'])}: generado ${v(r['iva_generado'])}, descontable ${v(r['iva_descontable'])}. Saldo estimado: ${v(r['saldo_a_pagar'])}. ${v(r['nota'])}`,
  }],
  [/retencion|retefuente|reteiva|reteica|retuv|retien/, {
    herramienta: 'retenciones_periodo', argumentos: (t, d) => rangoDesdeTexto(t, d.hoy),
    redactar: (r) => `Del ${v(r['desde'])} al ${v(r['hasta'])}: retenciones practicadas por pagar ${v(r['total_por_pagar'])}; retenciones que le practicaron a la empresa ${v(r['total_a_favor'])}.`,
  }],
  [/(nos deben|cartera|cobrar|clientes deben|deudores|clientes (tienen|con) facturas|facturas vencidas)/, {
    herramienta: 'cartera_por_edades', argumentos: () => ({}),
    redactar: (r) => {
      const t = (r['terceros'] as { tercero: string; saldo: string }[]).slice(0, 3).map((x) => `${x.tercero} (${x.saldo})`).join(', ');
      return `Los clientes deben ${v(r['total'])}. Hasta 30 días: ${v(r['hasta_30_dias'])}; 31 a 60: ${v(r['de_31_a_60_dias'])}; 61 a 90: ${v(r['de_61_a_90_dias'])}; más de 90: ${v(r['mas_de_90_dias'])}.${t ? ` Los que más deben: ${t}.` : ''}`;
    },
  }],
  [/(debemos|proveedores|por pagar|pagarle)/, {
    herramienta: 'cuentas_por_pagar', argumentos: () => ({}),
    redactar: (r) => `A los proveedores se les debe ${v(r['total'])}. Con más de 30 días: ${v(r['de_31_a_60_dias'])} (31 a 60), ${v(r['de_61_a_90_dias'])} (61 a 90) y ${v(r['mas_de_90_dias'])} (más de 90).`,
  }],
  [/(gasto|gastamos|gastando|en que se va)/, {
    herramienta: 'top_gastos', argumentos: (t, d) => rangoDesdeTexto(t, d.hoy),
    redactar: (r) => {
      const g = r['gastos'] as { nombre: string; valor: string }[];
      return g.length ? `Los mayores gastos del ${v(r['desde'])} al ${v(r['hasta'])}: ${g.map((x) => `${x.nombre} ${x.valor}`).join('; ')}.` : 'No hay gastos registrados en ese período.';
    },
  }],
  [/(utilidad|ganancia|perdida|ganamos|gano la empresa|resultado|vendimos|ventas|ingresos)/, {
    herramienta: 'estado_resultados', argumentos: (t, d) => rangoDesdeTexto(t, d.hoy),
    redactar: (r) => `Del ${v(r['desde'])} al ${v(r['hasta'])}: ingresos operacionales ${v(r['ingresos_operacionales'])}, costo de ventas ${v(r['costo_de_ventas'])}, gastos operacionales ${v(r['gastos_operacionales'])}. ${r['resultado'] === 'pérdida' ? 'Pérdida' : 'Utilidad'} neta: ${v(r['utilidad_neta'])}.`,
  }],
  [/(banco|caja|efectivo|plata|disponible|liquidez)/, {
    herramienta: 'saldo_cuenta', argumentos: () => ({ cuenta: '11' }),
    redactar: (r) => `El disponible (caja y bancos) al ${v(r['fecha_corte'])} es ${v(r['saldo'])}.`,
  }],
  [/(activo|pasivo|patrimonio|balance general|situacion financiera)/, {
    herramienta: 'balance_general', argumentos: () => ({}),
    redactar: (r) => `Al ${v(r['fecha_corte'])}: activo ${v(r['activo'])}, pasivo ${v(r['pasivo'])} y patrimonio ${v(r['patrimonio'])}.`,
  }],
  [/\b(alerta|atencion|resumen|que hay|como vamos|como va|novedad|que debo revisar|que tengo pendiente)/, {
    herramienta: 'alertas_empresa', argumentos: () => ({}),
    redactar: () => '', // se arma aparte con resumenAlertas
  }],
];

/**
 * Asistente por reglas (sección 12.2): para PC sin IA o mientras el modelo carga. Detecta la intención
 * con palabras clave, llama la misma herramienta del motor y responde con una plantilla. Es exacto.
 */
export async function preguntarConReglas(pregunta: string, ctx: ContextoJarvis): Promise<RespuestaJarvis> {
  const inicio = Date.now();
  const d = await cargarDatos(ctx);
  const n = normalizar(pregunta);
  const cifras = new Set<bigint>();
  const intencion = INTENCIONES.find(([re]) => re.test(n))?.[1];
  if (!intencion) {
    return {
      texto: 'Puedo responder sobre: dinero en caja y bancos, cartera por edades, cuentas por pagar, utilidad, gastos, IVA, retenciones, balance general y alertas de la empresa.',
      herramientas: [], cifrasNoVerificadas: [], provisional: d.sync.pendientes > 0, motor: 'reglas', milisegundos: Date.now() - inicio,
    };
  }
  const argumentos = intencion.argumentos(pregunta, d);
  const { salida } = ejecutarHerramienta(intencion.herramienta, JSON.stringify(argumentos), d, cifras);
  const r = salida as Record<string, unknown>;
  const texto = 'error' in r ? String(r['error'])
    : intencion.herramienta === 'alertas_empresa' ? resumenAlertas(calcularAlertas(d)) : intencion.redactar(r);
  return {
    texto, herramientas: [{ nombre: intencion.herramienta, argumentos, resultado: salida }],
    cifrasNoVerificadas: intencion.herramienta === 'alertas_empresa' ? [] : verificarCifras(texto, cifras),
    provisional: d.sync.pendientes > 0, motor: 'reglas', milisegundos: Date.now() - inicio,
  };
}

export { dinero };
