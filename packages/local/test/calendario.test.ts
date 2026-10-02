import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, guardarEmpresas, sincronizar, leerCalendarioCsv, PLANTILLA_CALENDARIO, vencimientosLocales, resumenEmpresa, catalogoObligaciones,
  obligacionesEmpresa,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let firma: string;
let empresa: string;

describe('lectura del calendario tributario (CSV)', () => {
  it('lee la plantilla y valida cada fila', () => {
    const r = leerCalendarioCsv(PLANTILLA_CALENDARIO, 2026);
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ obligacion: 'RETENCION', periodo: '2026-01', digito: '1', fecha: '2026-02-10' });
    expect(r.filas[3]).toMatchObject({ obligacion: 'EXOGENA', digito: null });
    const malo = leerCalendarioCsv(['iva bim;IVA;2026-B1;1;10/03/2026', 'X;;p;1;10/03/2026', 'IVA_BIM;IVA;B1;11;10/03/2026',
      'IVA_BIM;IVA;B1;1;31/02/2026', 'IVA_BIM;IVA;B1;1;10/03/2030'].join('\n'), 2026);
    expect(malo.filas.map((f) => f.obligacion)).toEqual(['IVA_BIM']); // "iva bim" se normaliza
    expect(malo.errores).toEqual([
      'Fila 2: código de obligación inválido "X" (letras, números, _ o -).',
      'Fila 3: el último dígito del NIT debe ser de 0 a 9 (o vacío si aplica a todos).',
      'Fila 4: fecha inválida "31/02/2026" (dd/mm/aaaa).',
      'Fila 5: la fecha 10/03/2030 no corresponde al calendario de 2026.',
    ]);
  });
});

describe('vencimientos de cada empresa (panel del contador)', () => {
  beforeAll(async () => {
    db = await crearBaseDePrueba();
    await registrarUsuario(db, ana.sub!, ana.email!);
    firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
    empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123458', 2::smallint, 'Andina') as e`, [firma]))[0]!.e;
  });

  it('el calendario y las obligaciones guardados en el servidor llegan al PC y dan los vencimientos y la alerta', async () => {
    // FECHAS DE EJEMPLO PARA PRUEBAS: no son las del decreto.
    const { filas } = leerCalendarioCsv(['RETENCION;Retención en la fuente;2026-09;8;06/10/2026', 'RETENCION;Retención en la fuente;2026-09;9;07/10/2026',
      'IVA_BIM;IVA bimestral;2026-B5;8;12/11/2026', 'RENTA;Renta;2025;8;12/05/2026'].join('\n'), 2026);
    await enServidor(db, ana, 'select public.guardar_calendario($1, 2026, $2::jsonb)', [empresa, JSON.stringify(filas)]);
    await enServidor(db, ana, `select public.guardar_obligaciones($1, array['RETENCION', 'IVA_BIM'])`, [empresa]);
    const base = baseNode();
    await migrar(base);
    await guardarEmpresas(base, [{ id: empresa, firma_id: firma, nit: '900123458', dv: 2, razon_social: 'Andina' }]);
    const { transporte } = transporteDirecto(db, ana);
    await sincronizar(base, transporte, { empresa, dispositivo: { id: randomUUID(), nombre: 'PC', version_app: '0.3.0' } });

    expect(await obligacionesEmpresa(base, empresa)).toEqual(['IVA_BIM', 'RETENCION']);
    expect((await catalogoObligaciones(base)).map((o) => o.codigo)).toEqual(['IVA_BIM', 'RENTA', 'RETENCION']);
    expect((await vencimientosLocales(base, empresa, '2026-10-02')).map((v) => [v.obligacion, v.fecha, v.dias]))
      .toEqual([['RETENCION', '2026-10-06', 4], ['IVA_BIM', '2026-11-12', 41]]);
    const r = await resumenEmpresa(base, empresa, '2026-10-02');
    expect(r.alertas).toContain('1 vencimiento(s) en 7 días');
    expect((await resumenEmpresa(base, empresa, '2026-10-06')).alertas).toContain('Hoy vence: Retención en la fuente');
  });
});
