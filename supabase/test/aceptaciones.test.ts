import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, como, registrarUsuario, type Sesion } from './entorno.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal1' };
let db: PGlite;
const pendientes = async () => (await como<{ p: { codigo: string; version: string }[] }>(db, ana, 'select public.documentos_pendientes() as p'))[0]!.p;
const aceptar = (docs: object[]) => como(db, ana, 'select public.aceptar_documentos($1::jsonb)', [JSON.stringify(docs)]);

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
});

describe('términos y política de datos con registro de aceptación', () => {
  it('mientras el abogado no los publique, la app no pide nada', async () => {
    expect(await pendientes()).toEqual([]);
    await expect(aceptar([{ codigo: 'terminos', version: '1' }])).rejects.toThrow(/DOCUMENTO_INVALIDO/);
  });

  it('publicados: pide la versión vigente, registra la aceptación una vez y vuelve a pedir si hay una nueva', async () => {
    await db.query(`update public.documentos_legales set publicado = true, vigente_desde = now() - interval '1 day'`);
    expect((await pendientes()).map((d) => `${d.codigo}@${d.version}`)).toEqual(['privacidad@1', 'terminos@1']);
    await aceptar([{ codigo: 'terminos', version: '1' }, { codigo: 'privacidad', version: '1' }]);
    await aceptar([{ codigo: 'terminos', version: '1' }]); // repetir no duplica
    expect(await pendientes()).toEqual([]);
    expect(await como(db, ana, 'select codigo, version from public.aceptaciones order by codigo')).toEqual([
      { codigo: 'privacidad', version: '1' }, { codigo: 'terminos', version: '1' }]);
    await db.query(`insert into public.documentos_legales values ('terminos', '2', 'Términos v2', '/terminos', true, now())`);
    expect((await pendientes()).map((d) => `${d.codigo}@${d.version}`)).toEqual(['terminos@2']);
  });

  it('nadie escribe ni borra aceptaciones directamente (son la prueba de la autorización)', async () => {
    await expect(como(db, ana, `delete from public.aceptaciones`)).rejects.toThrow(/permission denied/);
    await expect(como(db, ana, `insert into public.aceptaciones (usuario_id, codigo, version) values ($1, 'terminos', '1')`, [ana.sub])).rejects.toThrow(/permission denied/);
    await expect(como(db, { sub: null }, 'select public.documentos_pendientes()')).rejects.toThrow(/permission denied/);
  });
});
