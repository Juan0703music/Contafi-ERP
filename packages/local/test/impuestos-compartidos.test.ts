import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import { migrar, guardarEmpresas, sincronizar, parametrosDelAnio, conceptosRetencion, validarConcepto } from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let firma: string;
let andina: string;
let espiga: string;

async function nuevoPC() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [
    { id: andina, firma_id: firma, nit: '900123456', dv: 8, razon_social: 'Andina' },
    { id: espiga, firma_id: firma, nit: '901223556', dv: 9, razon_social: 'La Espiga' },
  ]);
  const { transporte } = transporteDirecto(db, ana);
  const dispositivo = { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' };
  const sync = (empresa: string) => sincronizar(base, transporte, { empresa, dispositivo });
  await sync(andina);
  await sync(espiga);
  return { base, sync };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  andina = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma]))[0]!.e;
  espiga = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '901223556', 9::smallint, 'La Espiga') as e`, [firma]))[0]!.e;
});

describe('configuración tributaria compartida entre PC (D-024)', () => {
  it('la UVT y los conceptos que se guardan en el servidor llegan a todos los PC', async () => {
    const pc1 = await nuevoPC();
    const pc2 = await nuevoPC();
    // Desde PC1 (en línea): se valida localmente y se guarda en el servidor
    const c = await validarConcepto(pc1.base, andina, {
      codigo: 'rf-servicios', tipo: 'RETEFUENTE', nombre: 'Servicios generales', tarifa: '4', baseMinimaUvt: '2,5', cuenta: '236525', aplicaEn: 'compras',
    });
    await enServidor(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [JSON.stringify({ ...c, empresa_id: andina })]);
    await enServidor(db, ana, 'select public.guardar_uvt($1, 2026, 49799)', [andina]);
    // PC2 los recibe al sincronizar, sin que nadie los escriba allí; la UVT también llega por La Espiga
    await pc2.sync(espiga);
    expect(await parametrosDelAnio(pc2.base, 2026)).toEqual({ anio: 2026, uvt: $('49799') });
    await pc2.sync(andina);
    expect(await conceptosRetencion(pc2.base, andina)).toEqual([expect.objectContaining({
      codigo: 'RF-SERVICIOS', tarifa: 40_000n, baseMinimaUvt: '2.5', cuenta: '236525', aplicaEn: 'compras', activo: true,
    })]);
    // Desactivar en el servidor también baja
    await enServidor(db, ana, 'select public.guardar_concepto_retencion($1::jsonb)', [JSON.stringify({ ...c, empresa_id: andina, activo: false })]);
    await pc1.sync(andina);
    expect((await conceptosRetencion(pc1.base, andina))[0]!.activo).toBe(false);
  });
});
