import { describe, expect, it } from 'vitest';
import { aCentavos as $ } from '@contafi/shared';
import {
  cargarDatos, ejecutarHerramienta, verificarCifras, calcularAlertas, preguntarConReglas, preguntarConIA, evaluar,
  definicionesOpenAI, HERRAMIENTAS, bimestre, clienteLlamaServer, ErrorRespuestaModelo, type ClienteLLM, type MensajeLLM,
} from '../src/index.ts';
import { guardarCalendario, guardarObligaciones, leerCalendarioCsv } from '@contafi/local';
import { EMPRESA, HOY, empresaDePrueba } from './ayudas.ts';

const ctx = async () => ({ base: await empresaDePrueba(), empresa: EMPRESA, hoy: HOY });
const usar = async (nombre: string, args: object = {}) => {
  const d = await cargarDatos(await ctx());
  const cifras = new Set<bigint>();
  return { salida: ejecutarHerramienta(nombre, JSON.stringify(args), d, cifras).salida as Record<string, unknown>, cifras };
};

describe('herramientas (el motor calcula, no la IA)', () => {
  it('saldo por código o por nombre, con el signo de la naturaleza', async () => {
    // Disponible: 55.000.000 + 9.750.000 − 3.200.000 × 4 − 9.500.000 = 42.450.000
    expect((await usar('saldo_cuenta', { cuenta: '11' })).salida).toMatchObject({ nombre: 'Disponible', saldo: '$ 42.450.000' });
    expect((await usar('saldo_cuenta', { cuenta: 'bancos' })).salida).toMatchObject({ cuenta: '1110', saldo: '$ 37.450.000' });
    expect((await usar('saldo_cuenta', { cuenta: '2205' })).salida).toMatchObject({ saldo: '$ 20.970.000' }); // pasivo positivo
    expect((await usar('saldo_cuenta', { cuenta: 'criptomonedas' })).salida).toHaveProperty('error');
  });

  it('cartera por edades y cuentas por pagar', async () => {
    const c = (await usar('cartera_por_edades')).salida;
    expect(c).toMatchObject({ total: '$ 31.900.000', hasta_30_dias: '$ 11.900.000', mas_de_90_dias: '$ 20.000.000' });
    expect((c['terceros'] as { tercero: string }[])[0]!.tercero).toBe('Distribuciones El Roble S.A.S.');
    expect((await usar('cuentas_por_pagar')).salida).toMatchObject({ total: '$ 20.970.000', mas_de_90_dias: '$ 20.970.000' });
  });

  it('resultados, balance, IVA, retenciones, gastos, búsquedas y comparación', async () => {
    expect((await usar('estado_resultados')).salida).toMatchObject({ ingresos_operacionales: '$ 35.000.000', gastos_operacionales: '$ 22.300.000', utilidad_neta: '$ 12.700.000' });
    expect((await usar('balance_general')).salida).toMatchObject({ cuadra: true });
    expect(bimestre('2026-09-30')).toEqual({ desde: '2026-09-01', hasta: '2026-10-31' });
    expect((await usar('iva_periodo')).salida).toMatchObject({ iva_generado: '$ 1.900.000', iva_descontable: '$ 0', saldo_a_pagar: '$ 1.900.000' });
    expect((await usar('retenciones_periodo', { desde: '2026-01-01', hasta: '2026-12-31' })).salida).toMatchObject({ total_por_pagar: '$ 450.000' });
    expect((await usar('top_gastos', { cantidad: 1 })).salida['gastos']).toEqual([{ cuenta: '5120', nombre: 'Arrendamientos', valor: '$ 22.300.000' }]);
    expect(((await usar('buscar_tercero', { texto: 'roble' })).salida['terceros'] as object[])[0]).toMatchObject({ nos_debe: '$ 31.900.000' });
    expect(((await usar('buscar_comprobante', { texto: 'arriendo marzo' })).salida['comprobantes'] as object[])).toHaveLength(1);
    const comp = (await usar('comparar_periodos', { desde_a: '2026-08-01', hasta_a: '2026-08-31', desde_b: '2026-09-01', hasta_b: '2026-09-30' })).salida;
    expect(comp['diferencia']).toMatchObject({ ingresos: '$ 10.000.000' });
  });

  it('se publican en formato OpenAI / llama-server', () => {
    const defs = definicionesOpenAI();
    expect(defs).toHaveLength(HERRAMIENTAS.length);
    expect(defs[0]).toMatchObject({ type: 'function', function: { name: 'saldo_cuenta', parameters: { type: 'object', required: ['cuenta'] } } });
  });
});

describe('verificación de cifras: la IA no inventa', () => {
  it('acepta las cifras copiadas de las herramientas y detecta las inventadas', async () => {
    const { cifras } = await usar('saldo_cuenta', { cuenta: '11' });
    expect(verificarCifras('Hay $ 42.450.000 en caja y bancos.', cifras)).toEqual([]);
    expect(verificarCifras('Hay 42.450.000 pesos.', cifras)).toEqual([]);
    expect(verificarCifras('Hay $ 42.500.000 en caja y bancos, unos $45 millones.', cifras)).toEqual(['$ 42.500.000', '$45']);
    expect(verificarCifras('El 30 de septiembre de 2026 hay 2 cuentas.', cifras)).toEqual([]); // fechas y conteos no son montos
  });
});

describe('alertas proactivas (reglas)', () => {
  it('cartera vencida, proveedores, IVA, meses sin cerrar y gasto inusual', async () => {
    const alertas = calcularAlertas(await cargarDatos(await ctx()));
    const titulos = alertas.map((a) => a.titulo);
    expect(titulos).toContain('Cartera con más de 30 días: $ 20.000.000');
    expect(titulos).toContain('Cuentas por pagar con más de 30 días: $ 20.970.000');
    expect(titulos).toContain('IVA estimado del bimestre: $ 1.900.000 por pagar');
    expect(alertas.find((a) => a.id === 'periodos')).toMatchObject({ detalle: 'enero, febrero, marzo, junio, julio, agosto' });
    // Arriendo de septiembre: 9.500.000 contra un promedio de 3.200.000
    expect(alertas.find((a) => a.id === 'gasto-5120')).toMatchObject({ titulo: 'Gasto inusual en Arrendamientos' });
    expect(alertas[0]!.nivel).toBe('alta');
  });
});

describe('asistente por reglas (PC sin IA)', () => {
  it('responde con cifras exactas del motor', async () => {
    const r = await preguntarConReglas('¿Cuánta plata tenemos en bancos?', await ctx());
    expect(r).toMatchObject({ motor: 'reglas', cifrasNoVerificadas: [], provisional: false });
    expect(r.texto).toBe('El disponible (caja y bancos) al 2026-09-30 es $ 42.450.000.');
    const t = await preguntarConReglas('¿Cuánto nos debe Distribuciones El Roble?', await ctx());
    expect(t.texto).toContain('nos debe $ 31.900.000');
  });

  it('banco de evaluación: elige la herramienta correcta en al menos el 90 % de las preguntas', async () => {
    const c = await ctx();
    const r = await evaluar((p) => preguntarConReglas(p, c));
    if (r.porcentajeHerramienta < 90) console.log(r.fallos.map((f) => `${f.pregunta} → ${f.usadas.join(',') || 'ninguna'} (esperada ${f.esperada})`).join('\n'));
    expect(r.porcentajeHerramienta).toBeGreaterThanOrEqual(90);
    expect(r.porcentajeCifras).toBe(100);
  });
});

describe('camino rápido', () => {
  it('solo toma preguntas cortas con una sola intención clara', async () => {
    const { intencionClara } = await import('../src/index.ts');
    expect(intencionClara('¿Cuánta plata tenemos en bancos?')).toBe('saldo_cuenta');
    expect(intencionClara('¿Cuánto IVA hay que pagar?')).toBe('iva_periodo');
    expect(intencionClara('¿y el mes pasado?')).toBeNull(); // seguimiento: lo resuelve la IA con el historial
    expect(intencionClara('¿Por qué la utilidad fue menor que los gastos de bancos?')).toBeNull(); // varias intenciones
  });
});

describe('asistente con IA (con un modelo simulado)', () => {
  /** Simula al modelo: pide una herramienta y luego responde con el texto indicado. */
  function modelo(llamada: { nombre: string; argumentos: object } | null, respuesta: (resultado: string) => string): ClienteLLM & { recibidos: MensajeLLM[][] } {
    const recibidos: MensajeLLM[][] = [];
    return {
      recibidos,
      async completar(mensajes) {
        recibidos.push(structuredClone(mensajes));
        const ultimo = mensajes.at(-1)!;
        if (llamada && ultimo.role === 'user') return { contenido: null, llamadas: [{ id: 'c1', nombre: llamada.nombre, argumentos: JSON.stringify(llamada.argumentos) }] };
        return { contenido: respuesta(ultimo.content ?? ''), llamadas: [] };
      },
    };
  }

  it('ejecuta la herramienta que pide el modelo, le pasa el resultado y verifica la respuesta', async () => {
    const m = modelo({ nombre: 'saldo_cuenta', argumentos: { cuenta: '11' } }, (res) => `Tienen ${JSON.parse(res).saldo} en caja y bancos.`);
    const r = await preguntarConIA('¿Cuánta plata hay?', await ctx(), m);
    expect(r).toMatchObject({ motor: 'ia', texto: 'Tienen $ 42.450.000 en caja y bancos.', cifrasNoVerificadas: [] });
    expect(r.herramientas.map((h) => h.nombre)).toEqual(['saldo_cuenta']);
    expect(m.recibidos[0]![0]!.content).toContain('NUNCA calcules');
    // La empresa y la fecha van en la pregunta, no en las instrucciones (caché del modelo)
    expect(m.recibidos[0]![0]!.content).not.toContain('2026');
    expect(m.recibidos[0]!.at(-1)!.content).toBe('[Empresa: Comercializadora Andina S.A.S. · Hoy: 2026-09-30]\n¿Cuánta plata hay?');
  });

  it('marca la respuesta si el modelo inventa o redondea una cifra', async () => {
    const m = modelo({ nombre: 'saldo_cuenta', argumentos: { cuenta: '11' } }, () => 'Tienen unos $ 42.000.000 en caja y bancos.');
    const r = await preguntarConIA('¿Cuánta plata hay?', await ctx(), m);
    expect(r.cifrasNoVerificadas).toEqual(['$ 42.000.000']);
  });

  it('herramienta inexistente o argumentos rotos: el error vuelve al modelo, no rompe la app', async () => {
    const m = modelo({ nombre: 'borrar_todo', argumentos: {} }, (res) => `No pude: ${JSON.parse(res).error}`);
    const r = await preguntarConIA('Borra todo', await ctx(), m);
    expect(r.texto).toBe('No pude: No existe la herramienta borrar_todo.');
  });

  it('si el modelo pregunta de vuelta en lugar de consultar, se reintenta obligándolo a usar una herramienta', async () => {
    const pedidos: (boolean | undefined)[] = [];
    const m: ClienteLLM = {
      async completar(mensajes, _h, o) {
        pedidos.push(o?.obligarHerramienta);
        if (mensajes.at(-1)!.role === 'tool') return { contenido: `Les deben ${JSON.parse(mensajes.at(-1)!.content!).total}.`, llamadas: [] };
        return o?.obligarHerramienta
          ? { contenido: null, llamadas: [{ id: 'x', nombre: 'cartera_por_edades', argumentos: '{}' }] }
          : { contenido: '¿Cuánto se les debe a los proveedores?', llamadas: [] };
      },
    };
    const r = await preguntarConIA('¿Cuánto nos deben los clientes?', await ctx(), m);
    expect(pedidos).toEqual([undefined, true, undefined]);
    expect(r).toMatchObject({ texto: 'Les deben $ 31.900.000.', cifrasNoVerificadas: [] });
  });

  it('si escribe la herramienta como texto o inventa una cifra, también se reintenta; un seguimiento conversacional no', async () => {
    const pedidos: (boolean | undefined)[] = [];
    const sinDatos = (contenido: string): ClienteLLM => ({
      async completar(mensajes, _h, o) {
        pedidos.push(o?.obligarHerramienta);
        if (mensajes.at(-1)!.role === 'tool') return { contenido: `Les deben ${JSON.parse(mensajes.at(-1)!.content!).total}.`, llamadas: [] };
        return o?.obligarHerramienta ? { contenido: null, llamadas: [{ id: 'x', nombre: 'cartera_por_edades', argumentos: '{}' }] } : { contenido, llamadas: [] };
      },
    });
    for (const c of ['cartera_por_edades', 'Les deben $12.500.000.']) {
      pedidos.length = 0;
      expect((await preguntarConIA('¿Cuánto nos deben?', await ctx(), sinDatos(c))).texto).toBe('Les deben $ 31.900.000.');
      expect(pedidos).toEqual([undefined, true, undefined]);
    }
    // Pregunta nueva sin cifras: igual se exige consultar. Seguimiento sin cifras ("gracias"): no.
    pedidos.length = 0;
    await preguntarConIA('¿Y eso es mucho?', await ctx(), sinDatos('Depende del sector.'));
    expect(pedidos[1]).toBe(true);
    pedidos.length = 0;
    const r = await preguntarConIA('Gracias', await ctx(), sinDatos('Con gusto.'), [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Hola' }]);
    expect([r.texto, pedidos]).toEqual(['Con gusto.', [undefined]]);
  });

  it('una llamada a herramienta cortada (error 500 de llama-server) es un error del modelo, no del servidor', async () => {
    const con = (status: number, cuerpo: string) => clienteLlamaServer({ url: 'http://x', fetch: (async () => new Response(cuerpo, { status })) as typeof fetch });
    await expect(con(500, '{"error":{"message":"Failed to parse tool call arguments as JSON"}}').completar([], [])).rejects.toBeInstanceOf(ErrorRespuestaModelo);
    const otro = await con(503, 'Loading model').completar([], []).catch((e: Error) => e);
    expect(otro).toBeInstanceOf(Error);
    expect(otro).not.toBeInstanceOf(ErrorRespuestaModelo);
  });

  it('las cifras que vienen escritas en los resultados (alertas) cuentan como verificadas', async () => {
    const m = modelo({ nombre: 'alertas_empresa', argumentos: {} }, () => 'Hay cartera vencida por $20.000.000 y deudas con proveedores por $20.970.000.');
    expect((await preguntarConIA('¿Qué alertas hay?', await ctx(), m)).cifrasNoVerificadas).toEqual([]);
  });

  it('quita el bloque de "pensamiento" de los modelos Qwen3', async () => {
    const m = modelo(null, () => '<think>debo saludar</think>Hola, ¿en qué te ayudo?');
    expect((await preguntarConIA('hola', await ctx(), m)).texto).toBe('Hola, ¿en qué te ayudo?');
  });
});

void $;

describe('calendario tributario', () => {
  it('alerta y responde lo que vence según el calendario cargado y el último dígito del NIT', async () => {
    const base = await empresaDePrueba();
    const c = { base, empresa: EMPRESA, hoy: HOY };
    expect((await preguntarConReglas('¿Qué vence este mes?', c)).texto).toMatch(/Calendario tributario/); // sin calendario
    // FECHAS DE EJEMPLO PARA PRUEBAS: no son las del decreto. El NIT de la empresa termina en 6.
    const { filas } = leerCalendarioCsv(['RETENCION;Retención en la fuente;2026-09;6;06/10/2026', 'RETENCION;Retención en la fuente;2026-09;7;07/10/2026',
      'IVA_BIM;IVA bimestral;2026-B4;6;30/09/2026'].join('\n'), 2026);
    await guardarCalendario(base, 2026, filas);
    await guardarObligaciones(base, EMPRESA.id, ['RETENCION', 'IVA_BIM']);
    const alerta = calcularAlertas(await cargarDatos(c)).find((a) => a.id === 'vencimientos');
    expect(alerta).toMatchObject({ nivel: 'alta', titulo: 'Hoy vence: IVA bimestral (2026-B4)' });
    expect(alerta!.detalle).toBe('IVA bimestral 2026-B4: 2026-09-30 (hoy) · Retención en la fuente 2026-09: 2026-10-06 (en 6 días)');
    const r = await preguntarConReglas('¿Qué vence este mes?', c);
    expect(r.herramientas.map((h) => h.nombre)).toEqual(['proximos_vencimientos']);
    expect(r.texto).toBe('En los próximos 30 días vence: IVA bimestral 2026-B4 el 2026-09-30 (hoy); Retención en la fuente 2026-09 el 2026-10-06 (en 6 días).');
  });
});
