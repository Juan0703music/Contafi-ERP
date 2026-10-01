/**
 * Evaluación de Jarvis (sección 12.5) con la empresa de prueba.
 *   node scripts/evaluar.ts                         → asistente por reglas
 *   node scripts/evaluar.ts http://127.0.0.1:8080   → modelo en llama-server (con --jinja)
 * Metas: herramienta correcta ≥ 90 %, cifras verificadas 100 %, respuesta < 10 s en un PC de 8 GB.
 */
import { clienteLlamaServer, evaluar, preguntarConIA, preguntarConReglas } from '../src/index.ts';
import { EMPRESA, HOY, empresaDePrueba } from '../test/ayudas.ts';

const url = process.argv[2];
const ctx = { base: await empresaDePrueba(), empresa: EMPRESA, hoy: HOY };
const cliente = url ? clienteLlamaServer({ url, token: process.env.LLAMA_TOKEN }) : null;
console.log(`Evaluando ${cliente ? `el modelo en ${url}` : 'el asistente por reglas'}…`);
const r = await evaluar((p) => (cliente ? preguntarConIA(p, ctx, cliente) : preguntarConReglas(p, ctx)));
console.log(`\nHerramienta correcta: ${r.herramientaCorrecta}/${r.total} (${r.porcentajeHerramienta} %)  meta ≥ 90 %`);
console.log(`Cifras verificadas:   ${r.cifrasVerificadas}/${r.total} (${r.porcentajeCifras} %)  meta 100 %`);
console.log(`Tiempo promedio: ${(r.milisegundosPromedio / 1000).toFixed(1)} s · máximo ${(r.milisegundosMaximo / 1000).toFixed(1)} s  meta < 10 s`);
for (const f of r.fallos) {
  console.log(`\n✗ ${f.pregunta}\n  esperada: ${f.esperada} · usó: ${f.usadas.join(', ') || 'ninguna'}${f.cifrasNoVerificadas.length ? ` · cifras no verificadas: ${f.cifrasNoVerificadas.join(', ')}` : ''}\n  respuesta: ${f.respuesta}`);
}
