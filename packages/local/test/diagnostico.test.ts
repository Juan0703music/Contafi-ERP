import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import { migrar, guardarEmpresas, sincronizar, crearComprobante, crearTercero, diagnosticoLocal, textoDiagnostico } from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let empresa: string;
let firma: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma]))[0]!.e;
});

describe('diagnóstico para soporte', () => {
  it('mide sincronizaciones, fallos y pendientes, sin montos ni nombres', async () => {
    const base = baseNode();
    await migrar(base);
    await guardarEmpresas(base, [{ id: empresa, firma_id: firma, nit: '900123456', dv: 8, razon_social: 'Andina' }]);
    const { transporte, estado } = transporteDirecto(db, ana);
    const dispositivo = { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' };
    const sync = () => sincronizar(base, transporte, { empresa, dispositivo });
    await sync();
    estado.enLinea = false;
    const t = await crearTercero(base, empresa, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Distribuciones El Roble', tipos: ['cliente'] });
    await crearComprobante(base, empresa, { tipo: 'CG', fecha: '2026-09-10', concepto: 'Venta secreta a El Roble', lineas: [
      { cuenta: '130505', terceroId: t, debito: $('7654321'), credito: 0n }, { cuenta: '413595', debito: 0n, credito: $('7654321') }] });
    await sync();
    let d = await diagnosticoLocal(base, empresa);
    expect(d.metricas).toMatchObject({ sincronizaciones: 2, fallos: 1 });
    expect(d.cola).toEqual([
      { tipo: 'comprobante', cantidad: 1, maxIntentos: 1, ultimoError: 'No hay conexión con el servidor.' },
      { tipo: 'tercero', cantidad: 1, maxIntentos: 1, ultimoError: 'No hay conexión con el servidor.' },
    ]);
    estado.enLinea = true;
    await sync();
    d = await diagnosticoLocal(base, empresa);
    expect(d.cola).toEqual([]);
    expect(d.comprobantes).toEqual({ contabilizado: 1 });
    expect(d.erroresPorMil).toBeGreaterThan(0);
    const texto = textoDiagnostico(d, { app: '0.3.0', sistema: 'Windows 11', modo: 'nube', nit: '900123456', dispositivo: dispositivo.id });
    expect(texto).toContain('Pendientes: ninguno');
    expect(texto).toContain('fallos de red 1');
    expect(texto).toMatch(/Último fallo: \S+ No hay conexión/);
    // Nada de montos, nombres ni conceptos
    for (const prohibido of ['7654321', '7.654.321', 'Roble', 'secreta', 'Andina']) expect(texto).not.toContain(prohibido);
  });
});
