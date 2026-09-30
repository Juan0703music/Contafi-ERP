#!/usr/bin/env node
/**
 * Prueba de la Fase 0: lee XML/ZIP reales de la DIAN y muestra lo extraído.
 * Uso: pnpm --filter @contafi/dian-xml leer <archivo.xml|archivo.zip|carpeta> [NIT de la empresa]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { formatoCOP, aCentavos } from '@contafi/shared';
import { leerDocumentoDian, leerZip, type ArchivoLeido } from './leer.ts';
import { proponerAsiento } from './propuesta.ts';

const [ruta, nitEmpresa] = process.argv.slice(2);
if (!ruta) {
  console.error('Uso: leer <archivo.xml|archivo.zip|carpeta> [NIT de la empresa]');
  process.exit(1);
}

function archivos(r: string): string[] {
  return statSync(r).isDirectory()
    ? readdirSync(r).flatMap((f) => archivos(join(r, f)))
    : ['.xml', '.zip'].includes(extname(r).toLowerCase()) ? [r] : [];
}

const resultados: ArchivoLeido[] = [];
for (const a of archivos(ruta)) {
  if (a.toLowerCase().endsWith('.zip')) {
    resultados.push(...leerZip(readFileSync(a)).map((x) => ({ ...x, nombre: `${a} → ${x.nombre}` })));
  } else {
    try { resultados.push({ nombre: a, documento: leerDocumentoDian(readFileSync(a, 'utf8')) }); }
    catch (e) { resultados.push({ nombre: a, error: (e as Error).message }); }
  }
}

let ok = 0, conAdvertencias = 0;
const cufes = new Set<string>();
for (const r of resultados) {
  console.log(`\n■ ${r.nombre}`);
  if (!r.documento) { console.log(`  ERROR: ${r.error}`); continue; }
  const d = r.documento;
  ok++;
  if (cufes.has(d.cufe)) console.log('  ⚠ DUPLICADO: este CUFE ya apareció en otro archivo');
  cufes.add(d.cufe);
  console.log(`  ${d.tipo} ${d.numero} del ${d.fechaEmision} · ${d.lineas.length} líneas · DIAN: ${d.validacionDian?.descripcion ?? 'sin respuesta adjunta'}`);
  console.log(`  Emisor:      ${d.emisor.nit}-${d.emisor.dv ?? '?'} ${d.emisor.razonSocial}`);
  console.log(`  Adquiriente: ${d.adquiriente.nit}-${d.adquiriente.dv ?? '?'} ${d.adquiriente.razonSocial}`);
  console.log(`  Subtotal ${formatoCOP(d.subtotal)} · Impuestos ${d.impuestos.map((i) => `${i.codigo}:${formatoCOP(i.valor)}`).join(' ') || '—'} · Total ${formatoCOP(d.totalAPagar)}`);
  if (d.retenciones.length) console.log(`  Retenciones informadas: ${d.retenciones.map((i) => `${i.codigo}:${formatoCOP(i.valor)}`).join(' ')}`);
  if (nitEmpresa) {
    try {
      const p = proponerAsiento(d, { nitEmpresa, parametros: { anio: Number(d.fechaEmision.slice(0, 4)), uvt: aCentavos('52374') } });
      console.log(`  Asiento propuesto (${p.sentido}):`);
      for (const l of p.lineas) console.log(`    ${l.cuenta.padEnd(8)} ${l.debito ? formatoCOP(l.debito).padStart(18) : ''.padStart(18)} ${l.credito ? formatoCOP(l.credito).padStart(18) : ''.padStart(18)}  ${l.nota ?? ''}`);
      for (const a of p.advertencias.filter((x) => !d.advertencias.includes(x))) console.log(`  ⚠ ${a}`);
    } catch (e) { console.log(`  (sin asiento: ${(e as Error).message})`); }
  }
  if (d.advertencias.length) { conAdvertencias++; for (const a of d.advertencias) console.log(`  ⚠ ${a}`); }
}
console.log(`\nResumen: ${resultados.length} archivos · ${ok} leídos · ${resultados.length - ok} con error · ${conAdvertencias} con advertencias`);
