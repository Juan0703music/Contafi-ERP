import type { RespuestaJarvis } from './asistente.ts';

/**
 * Banco de preguntas para elegir y vigilar el modelo (sección 12.5). Cada una dice qué herramienta
 * debe usarse. Se ampliará con las 150 preguntas reales de los contadores del piloto.
 */
export const BANCO_PREGUNTAS: { pregunta: string; herramienta: string }[] = [
  { pregunta: '¿Cuánta plata tenemos en bancos?', herramienta: 'saldo_cuenta' },
  { pregunta: '¿Cuánto hay en caja y bancos hoy?', herramienta: 'saldo_cuenta' },
  { pregunta: '¿Cuál es el saldo de la cuenta 1435?', herramienta: 'saldo_cuenta' },
  { pregunta: 'Dime el saldo del disponible', herramienta: 'saldo_cuenta' },
  { pregunta: '¿Cómo está la liquidez de la empresa?', herramienta: 'saldo_cuenta' },
  { pregunta: '¿Cuánto nos deben los clientes?', herramienta: 'cartera_por_edades' },
  { pregunta: '¿Cómo está la cartera por edades?', herramienta: 'cartera_por_edades' },
  { pregunta: '¿Qué clientes tienen facturas de más de 90 días?', herramienta: 'cartera_por_edades' },
  { pregunta: '¿Cuánto tenemos por cobrar?', herramienta: 'cartera_por_edades' },
  { pregunta: '¿Cuánto les debemos a los proveedores?', herramienta: 'cuentas_por_pagar' },
  { pregunta: '¿Qué tenemos pendiente por pagar?', herramienta: 'cuentas_por_pagar' },
  { pregunta: '¿A qué proveedores les debemos hace más de 30 días?', herramienta: 'cuentas_por_pagar' },
  { pregunta: '¿Cuánto ganamos este año?', herramienta: 'estado_resultados' },
  { pregunta: '¿Cuál es la utilidad del mes?', herramienta: 'estado_resultados' },
  { pregunta: '¿Tuvimos pérdida el mes pasado?', herramienta: 'estado_resultados' },
  { pregunta: '¿Cuánto vendimos este año?', herramienta: 'estado_resultados' },
  { pregunta: '¿Cuáles fueron los ingresos del año pasado?', herramienta: 'estado_resultados' },
  { pregunta: '¿Cuánto IVA hay que pagar este bimestre?', herramienta: 'iva_periodo' },
  { pregunta: '¿Cuánto IVA descontable tenemos?', herramienta: 'iva_periodo' },
  { pregunta: 'Muéstrame el IVA generado del mes', herramienta: 'iva_periodo' },
  { pregunta: '¿Cuánto hay que pagar de retención en la fuente este mes?', herramienta: 'retenciones_periodo' },
  { pregunta: '¿Cuánto nos retuvieron los clientes?', herramienta: 'retenciones_periodo' },
  { pregunta: '¿Cuánto debemos de reteICA?', herramienta: 'retenciones_periodo' },
  { pregunta: '¿En qué estamos gastando más?', herramienta: 'top_gastos' },
  { pregunta: '¿Cuáles son los gastos más altos del año?', herramienta: 'top_gastos' },
  { pregunta: 'Dame los 3 gastos principales del mes', herramienta: 'top_gastos' },
  { pregunta: '¿Cuánto suman los activos?', herramienta: 'balance_general' },
  { pregunta: '¿Cuál es el patrimonio de la empresa?', herramienta: 'balance_general' },
  { pregunta: '¿Cómo está el balance general?', herramienta: 'balance_general' },
  { pregunta: '¿Cuánto es el pasivo total?', herramienta: 'balance_general' },
  { pregunta: '¿Qué alertas hay?', herramienta: 'alertas_empresa' },
  { pregunta: '¿Cómo vamos? ¿Qué debo revisar?', herramienta: 'alertas_empresa' },
  { pregunta: 'Dame un resumen de lo que requiere atención', herramienta: 'alertas_empresa' },
  { pregunta: '¿Cuánto nos debe Distribuciones El Roble?', herramienta: 'buscar_tercero' },
  { pregunta: 'Busca el proveedor Suministros del Norte', herramienta: 'buscar_tercero' },
  { pregunta: '¿Quién es el tercero con NIT 830945221?', herramienta: 'buscar_tercero' },
  { pregunta: 'Busca el comprobante FV-000001', herramienta: 'buscar_comprobante' },
  { pregunta: '¿Dónde está registrado el arriendo de marzo?', herramienta: 'buscar_comprobante' },
  { pregunta: 'Compara la utilidad de febrero contra la de marzo', herramienta: 'comparar_periodos' },
  { pregunta: '¿Cómo nos fue este mes comparado con el mes pasado?', herramienta: 'comparar_periodos' },
  { pregunta: 'Muéstrame los últimos movimientos de bancos', herramienta: 'movimientos_cuenta' },
  { pregunta: '¿Qué productos se están acabando?', herramienta: 'inventario_bajo' },
  { pregunta: '¿Cómo está el inventario?', herramienta: 'inventario_bajo' },
  { pregunta: '¿Qué movimientos tuvo la cuenta 5195 este año?', herramienta: 'movimientos_cuenta' },
  { pregunta: '¿Qué vence este mes?', herramienta: 'proximos_vencimientos' },
  { pregunta: '¿Qué tengo que declarar esta semana?', herramienta: 'proximos_vencimientos' },
];

export interface ResultadoEvaluacion {
  total: number;
  herramientaCorrecta: number;
  cifrasVerificadas: number;
  porcentajeHerramienta: number;
  porcentajeCifras: number;
  milisegundosPromedio: number;
  milisegundosMaximo: number;
  fallos: { pregunta: string; esperada: string; usadas: string[]; respuesta: string; cifrasNoVerificadas: string[] }[];
}

/** Corre el banco contra cualquier asistente (IA o reglas) y mide las metas de la sección 12.5. */
export async function evaluar(
  responder: (pregunta: string) => Promise<RespuestaJarvis>, banco = BANCO_PREGUNTAS,
): Promise<ResultadoEvaluacion> {
  let correctas = 0, verificadas = 0, suma = 0, maximo = 0;
  const fallos: ResultadoEvaluacion['fallos'] = [];
  for (const q of banco) {
    const inicio = Date.now();
    // Un error en una pregunta cuenta como fallo de esa pregunta; la evaluación sigue.
    const r = await responder(q.pregunta).catch((e: Error): RespuestaJarvis => ({
      texto: `ERROR: ${e.message.slice(0, 160)}`, herramientas: [], cifrasNoVerificadas: [], provisional: false, motor: 'ia',
      milisegundos: Date.now() - inicio,
    }));
    const usadas = r.herramientas.map((h) => h.nombre);
    const ok = usadas.includes(q.herramienta);
    if (ok) correctas++;
    if (r.cifrasNoVerificadas.length === 0) verificadas++;
    suma += r.milisegundos;
    maximo = Math.max(maximo, r.milisegundos);
    if (!ok || r.cifrasNoVerificadas.length) {
      fallos.push({ pregunta: q.pregunta, esperada: q.herramienta, usadas, respuesta: r.texto, cifrasNoVerificadas: r.cifrasNoVerificadas });
    }
  }
  return {
    total: banco.length, herramientaCorrecta: correctas, cifrasVerificadas: verificadas,
    porcentajeHerramienta: Math.round((correctas / banco.length) * 1000) / 10,
    porcentajeCifras: Math.round((verificadas / banco.length) * 1000) / 10,
    milisegundosPromedio: Math.round(suma / banco.length), milisegundosMaximo: maximo, fallos,
  };
}
