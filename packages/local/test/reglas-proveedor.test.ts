import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  MIGRACIONES, migrar, guardarEmpresas, sincronizar, prepararImportacion, contabilizarImportacion, reglasProveedor, retencionesDeProveedor,
  sentenciasAprenderRegla, s,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`../../dian-xml/test/fixtures/${n}`, import.meta.url)));
const FACTURA = { nombre: 'factura.xml', contenido: fixture('factura-compra-attached.xml') };
const NOTA = { nombre: 'nc.xml', contenido: fixture('nota-credito.xml') };

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let empresa: { id: string; nit: string; firma: string };

async function nuevoPC() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa.id, firma_id: empresa.firma, nit: empresa.nit, dv: 8, razon_social: 'Andina SAS' }]);
  const { transporte, estado } = transporteDirecto(db, ana);
  const dispositivo = { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' };
  const sync = () => sincronizar(base, transporte, { empresa: empresa.id, dispositivo });
  await sync();
  return { base, sync, estado };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  const firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  const id = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina SAS') as e`, [firma]))[0]!.e;
  empresa = { id, nit: '900123456', firma };
});

describe('reglas por proveedor compartidas entre PC', () => {
  it('la migración 7 conserva lo que el PC ya había aprendido', async () => {
    const base = baseNode();
    for (const [i, m] of MIGRACIONES.slice(0, 6).entries()) await base.lote([...m.map((sql) => ({ sql })), { sql: `pragma user_version = ${i + 1}` }]);
    await base.lote([
      s(`insert into reglas_proveedor (empresa_id, nit, cuenta, actualizado_en) values ('e1', '901223556', '519530', '2026-09-01')`),
      s(`insert into retenciones_proveedor (empresa_id, nit, codigo) values ('e1', '901223556', 'RICA'), ('e1', '901223556', 'RF-COMPRAS'), ('e1', '830945221', 'RF-SERV')`),
    ]);
    expect(await migrar(base)).toBe(3);
    expect(await reglasProveedor(base, 'e1')).toEqual({ '901223556': '519530' }); // 830945221 solo tiene retenciones
    expect(await retencionesDeProveedor(base, 'e1', '901223556')).toEqual(['RF-COMPRAS', 'RICA']);
    expect(await retencionesDeProveedor(base, 'e1', '830945221')).toEqual(['RF-SERV']);
  });

  it('lo que aprende un PC lo sugiere el otro; aprender solo retenciones sin conexión no borra la cuenta', async () => {
    const pc1 = await nuevoPC();
    const pc2 = await nuevoPC();
    const [factura] = await prepararImportacion(pc1.base, empresa, [FACTURA]);
    await contabilizarImportacion(pc1.base, empresa, [{ item: factura!, cuenta: '519530' }]);
    expect((await pc1.sync()).error).toBeNull();

    await pc2.sync();
    const [nota] = await prepararImportacion(pc2.base, empresa, [NOTA]);
    expect(nota!.propuesta!.cuentaSugerida).toEqual({ cuenta: '519530', origen: 'regla' });

    // PC2, sin conexión, aprende las retenciones del mismo proveedor (sin tocar la cuenta)
    pc2.estado.enLinea = false;
    await pc2.base.lote(sentenciasAprenderRegla(empresa.id, '901.223.556', { retenciones: ['RF-COMPRAS'] }));
    expect((await pc2.sync()).error).toMatch(/conexión/);
    pc2.estado.enLinea = true;
    expect((await pc2.sync()).error).toBeNull();
    expect(await enServidor(db, ana, `select cuenta, retenciones from public.reglas_proveedor where nit = '901223556'`))
      .toEqual([{ cuenta: '519530', retenciones: ['RF-COMPRAS'] }]);
    await pc1.sync();
    expect(await retencionesDeProveedor(pc1.base, empresa.id, '901223556')).toEqual(['RF-COMPRAS']);
    expect(await reglasProveedor(pc1.base, empresa.id)).toEqual({ '901223556': '519530' });
  });
});
