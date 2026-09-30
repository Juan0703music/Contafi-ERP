import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, guardarEmpresas, sincronizar, leerComprobantes, tercerosLocales, prepararImportacion, contabilizarImportacion, reglasProveedor,
  guardarConcepto, guardarUvt, conceptosRetencion, recalcularPropuesta, retencionesDeProveedor, ErrorLocal,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const fixture = (n: string) => readFileSync(new URL(`../../dian-xml/test/fixtures/${n}`, import.meta.url));
const FACTURA = { nombre: 'ad0901223556.xml', contenido: new Uint8Array(fixture('factura-compra-attached.xml')) };
const NOTA = { nombre: 'nc.xml', contenido: new Uint8Array(fixture('nota-credito.xml')) };

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let empresa: { id: string; nit: string; firma: string };

async function nuevoPC() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa.id, firma_id: empresa.firma, nit: empresa.nit, dv: 8, razon_social: 'Andina SAS' }]);
  const { transporte } = transporteDirecto(db, ana);
  const dispositivo = { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' };
  const sync = () => sincronizar(base, transporte, { empresa: empresa.id, dispositivo });
  await sync();
  return { base, sync };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  const firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  const id = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma]))[0]!.e;
  empresa = { id, nit: '900123456', firma };
});

describe('importación de facturas electrónicas de la DIAN', () => {
  it('lee XML y ZIP, detecta duplicados en la misma carga, errores y documentos de otra empresa', async () => {
    const { base } = await nuevoPC();
    const zip = { nombre: 'correo.zip', contenido: zipSync({ 'factura.xml': FACTURA.contenido, 'factura.pdf': strToU8('%PDF'), 'roto.xml': strToU8('<Invoice>') }) };
    const items = await prepararImportacion(base, empresa, [FACTURA, NOTA, zip]);
    expect(items.map((i) => i.estado)).toEqual(['nuevo', 'nuevo', 'duplicado', 'error']);
    expect(items[0]!.propuesta).toMatchObject({ sentido: 'compra', tipoComprobante: 'FC' });
    expect(items[0]!.terceroId).toBeNull(); // el proveedor todavía no existe
    const ajena = await prepararImportacion(base, { id: empresa.id, nit: '800197268' }, [FACTURA]);
    expect(ajena[0]!.estado).toBe('ajeno');
  });

  it('contabiliza: crea el proveedor, el comprobante con IVA descontable, y no deja importarla dos veces', async () => {
    const { base, sync } = await nuevoPC();
    const items = await prepararImportacion(base, empresa, [FACTURA]);
    const r = await contabilizarImportacion(base, empresa, [{ item: items[0]! }]);
    expect(r).toMatchObject({ tercerosCreados: 1, fallidos: [] });
    const [t] = await tercerosLocales(base, empresa.id, '901223556');
    expect(t).toMatchObject({ nombre: 'IMPORTADORA SUMINISTROS DEL NORTE S.A.S.', dv: 9, tipos: ['proveedor'] });
    const [c] = await leerComprobantes(base, empresa.id, { estados: ['pendiente_sync'] });
    expect(c).toMatchObject({ tipo: 'FC', origen: 'importacion_dian', fecha: '2026-09-15' });
    expect(c!.lineas.find((l) => l.cuenta === '220505')).toMatchObject({ credito: $('1254400'), terceroId: t!.id });
    expect((await prepararImportacion(base, empresa, [FACTURA]))[0]!.estado).toBe('duplicado');
    const s = await sync();
    expect(s).toMatchObject({ contabilizados: 1, tercerosRegistrados: 1, error: null });
  });

  it('aprende la cuenta que el contador elige para el proveedor y la sugiere la próxima vez', async () => {
    const { base } = await nuevoPC();
    const [factura] = await prepararImportacion(base, empresa, [FACTURA]);
    expect(factura!.propuesta!.cuentaSugerida).toEqual({ cuenta: '519595', origen: 'defecto' });
    const r = await contabilizarImportacion(base, empresa, [{ item: factura!, cuenta: '519530' }]);
    expect(r.reglasAprendidas).toBe(1);
    expect(await reglasProveedor(base, empresa.id)).toEqual({ '901223556': '519530' });
    const [c] = await leerComprobantes(base, empresa.id, { estados: ['pendiente_sync'] });
    expect(c!.lineas[0]).toMatchObject({ cuenta: '519530', debito: $('1060000') });
    const [nota] = await prepararImportacion(base, empresa, [NOTA]);
    expect(nota!.propuesta!.cuentaSugerida).toEqual({ cuenta: '519530', origen: 'regla' });
    expect(nota!.terceroId).not.toBeNull(); // el proveedor ya existe
  });

  it('la misma factura importada en dos PC queda una sola vez en el servidor y en cada PC', async () => {
    const pc1 = await nuevoPC();
    const pc2 = await nuevoPC();
    const clave = `dian:${empresa.id}:`;
    const antes = (await enServidor<{ n: number }>(db, ana, `select count(*)::int as n from public.comprobantes where clave_idempotencia like $1 || '%'`, [clave]))[0]!.n;
    for (const pc of [pc1, pc2]) {
      const [item] = await prepararImportacion(pc.base, empresa, [NOTA]);
      await contabilizarImportacion(pc.base, empresa, [{ item: item! }]);
    }
    await pc1.sync();
    const r2 = await pc2.sync();
    expect(r2.error).toBeNull();
    const despues = (await enServidor<{ n: number }>(db, ana, `select count(*)::int as n from public.comprobantes where clave_idempotencia like $1 || '%'`, [clave]))[0]!.n;
    expect(despues - antes).toBe(1);
    const notas2 = (await leerComprobantes(pc2.base, empresa.id)).filter((c) => c.tipo === 'NC');
    const notas1 = (await leerComprobantes(pc1.base, empresa.id)).filter((c) => c.tipo === 'NC');
    expect(notas2).toHaveLength(1);
    expect(notas2[0]).toMatchObject({ id: notas1[0]!.id, estado: 'contabilizado', numero: notas1[0]!.numero });
    const [doc] = await pc2.base.consultar<{ comprobante_id: string }>('select comprobante_id from documentos_dian where cufe like ?', ['ffee%']);
    expect(doc!.comprobante_id).toBe(notas1[0]!.id);
  });
});

describe('retenciones configurables (sin tarifas escritas en el código)', () => {
  // VALORES DE EJEMPLO para la prueba: en la app los define el contador con la norma vigente.
  const RF = { codigo: 'RF-COMPRAS', tipo: 'RETEFUENTE' as const, nombre: 'Retención compras', tarifa: '2,5', baseMinimaUvt: '10', cuenta: '236540', aplicaEn: 'compras' as const };

  it('valida tarifa, base en UVT y que la cuenta sea auxiliar y del grupo correcto', async () => {
    const { base } = await nuevoPC();
    await expect(guardarConcepto(base, empresa.id, { ...RF, tarifa: '150' })).rejects.toThrow(/Tarifa inválida/);
    await expect(guardarConcepto(base, empresa.id, { ...RF, baseMinimaUvt: 'diez' })).rejects.toThrow(/UVT/);
    await expect(guardarConcepto(base, empresa.id, { ...RF, cuenta: '2365' })).rejects.toThrow(/no es auxiliar/);
    await expect(guardarConcepto(base, empresa.id, { ...RF, cuenta: '135515' })).rejects.toThrow(ErrorLocal);
    await guardarConcepto(base, empresa.id, RF);
    expect(await conceptosRetencion(base, empresa.id)).toEqual([expect.objectContaining({ codigo: 'RF-COMPRAS', tarifa: 25_000n, baseMinimaUvt: '10' })]);
  });

  it('aplica la retención elegida, la aprende para el proveedor y la propone sola la siguiente vez', async () => {
    const { base } = await nuevoPC();
    await guardarConcepto(base, empresa.id, RF);
    const [sinUvt] = await prepararImportacion(base, empresa, [FACTURA]);
    expect(sinUvt!.retenciones).toEqual([]); // aún no aprendida
    const conRf = await recalcularPropuesta(base, empresa, sinUvt!, ['RF-COMPRAS']);
    expect(conRf.propuesta!.advertencias.join(' ')).toMatch(/UVT de 2026/);

    await guardarUvt(base, 2026, '52.374'); // valor de ejemplo
    const [item] = await prepararImportacion(base, empresa, [FACTURA]);
    const elegido = await recalcularPropuesta(base, empresa, item!, ['RF-COMPRAS']);
    const rf = elegido.propuesta!.lineas.find((l) => l.cuenta === '236540');
    expect(rf?.credito).toBe($('26500'));
    expect(elegido.propuesta!.lineas.find((l) => l.cuenta === '220505')?.credito).toBe($('1254400') - $('26500'));
    await contabilizarImportacion(base, empresa, [{ item: elegido, retencionesCambiadas: true }]);
    expect(await retencionesDeProveedor(base, empresa.id, '901223556')).toEqual(['RF-COMPRAS']);

    const [nota] = await prepararImportacion(base, empresa, [NOTA]);
    expect(nota!.retenciones).toEqual(['RF-COMPRAS']);
    // Nota crédito de $380.000 de base: 2,5 % = $9.500, en sentido contrario
    expect(nota!.propuesta!.lineas.find((l) => l.cuenta === '236540')?.debito).toBe($('9500'));
  });
});
