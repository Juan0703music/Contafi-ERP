/**
 * SOLO DESARROLLO: voz de Jarvis (Piper) para probar la app en el navegador, donde no está Tauri.
 * En la app de escritorio esto lo hace el comando `voz_sintetizar` (Rust), sin puertos.
 *   PIPER_DIR=~/.cache/contafi-ia/piper node scripts/voz-desarrollo.mjs   → http://127.0.0.1:8093
 *   y en apps/escritorio/.env.local: VITE_PIPER_URL=http://127.0.0.1:8093
 * PIPER_DIR debe tener piper/piper y las voces (*.onnx y *.onnx.json).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.PIPER_DIR;
if (!DIR) { console.error('Falta PIPER_DIR'); process.exit(1); }
const PIPER = join(DIR, 'piper', 'piper');
const PUERTO = Number(process.env.PUERTO ?? 8093);

function leer(contenido, voz) {
  return new Promise((resolver, rechazar) => {
    const p = spawn(PIPER, ['--model', join(DIR, voz), '--output_file', '-', '--sentence_silence', '0.25', '--length_scale', '0.95'],
      { cwd: join(DIR, 'piper'), stdio: ['pipe', 'pipe', 'ignore'] });
    const trozos = [];
    p.stdout.on('data', (d) => trozos.push(d));
    p.on('error', rechazar);
    p.on('close', (codigo) => (codigo === 0 ? resolver(Buffer.concat(trozos)) : rechazar(new Error(`piper terminó con ${codigo}`))));
    p.stdin.end(`${contenido.replace(/[\r\n]+/g, ' ')}\n`);
  });
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST' || req.url !== '/leer') { res.statusCode = 404; return res.end(); }
  let cuerpo = '';
  for await (const t of req) cuerpo += t;
  try {
    const { contenido, voz } = JSON.parse(cuerpo);
    if (typeof contenido !== 'string' || !contenido.trim() || contenido.length > 4000) throw new Error('Texto inválido');
    if (typeof voz !== 'string' || !/^[\w-]+\.onnx$/.test(voz) || !existsSync(join(DIR, voz))) throw new Error('Voz no disponible');
    const wav = await leer(contenido, voz);
    res.setHeader('Content-Type', 'audio/wav');
    res.end(wav);
  } catch (e) {
    res.statusCode = 400;
    res.end(String(e.message ?? e));
  }
}).listen(PUERTO, '127.0.0.1', () => console.log(`Voz de desarrollo en http://127.0.0.1:${PUERTO}`));
