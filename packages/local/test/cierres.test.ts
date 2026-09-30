import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aCentavos as $ } from '@contafi/shared';
import { ErrorMotor, type Linea } from '@contafi/motor';
import { crearBaseDePrueba, registrarUsuario, type Sesion } from '@contafi/supabase/test/entorno';
import {
  migrar, guardarEmpresas, sincronizar, crearComprobante, crearTercero, balancePruebaLocal, leerComprobantes,
  resumenPeriodos, vistaCierreAnual, generarCierreAnual, leerSaldosIniciales, crearSaldosIniciales, PLANTILLA_SALDOS,
} from '../src/index.ts';
import { baseNode, enServidor, transporteDirecto } from './ayudas.ts';

const ana: Sesion = { sub: randomUUID(), email: 'ana@firma.co', aal: 'aal2' };
let db: PGlite;
let empresa: string;
const D = (cuenta: string, v: string, t: string | null = null): Linea => ({ cuenta, debito: $(v), credito: 0n, terceroId: t });
const C = (cuenta: string, v: string, t: string | null = null): Linea => ({ cuenta, debito: 0n, credito: $(v), terceroId: t });

async function nuevoPC() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: empresa, firma_id: randomUUID(), nit: '900123456', dv: 8, razon_social: 'Andina' }]);
  const { transporte } = transporteDirecto(db, ana);
  const sync = () => sincronizar(base, transporte, { empresa, dispositivo: { id: randomUUID(), nombre: 'PC', version_app: '1' } });
  await sync();
  return { base, sync };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
  await registrarUsuario(db, ana.sub!, ana.email!);
  const firma = (await enServidor<{ f: string }>(db, ana, `select public.crear_firma('Ortiz') as f`))[0]!.f;
  empresa = (await enServidor<{ e: string }>(db, ana, `select public.crear_empresa($1, '900123456', 8::smallint, 'Andina') as e`, [firma]))[0]!.e;
});

describe('saldos iniciales desde CSV', () => {
  it('lee la plantilla, valida cuentas, terceros y montos, y crea el comprobante SI', async () => {
    const { base, sync } = await nuevoPC();
    await crearTercero(base, empresa, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'El Roble', tipos: ['cliente'] });
    const r = await leerSaldosIniciales(base, empresa, PLANTILLA_SALDOS);
    expect(r.errores).toEqual([]);
    expect(r.lineas).toHaveLength(3);
    expect(r.totalDebitos).toBe($('62500000'));
    expect(r.totalDebitos).toBe(r.totalCreditos);
    const { numeroLocal } = await crearSaldosIniciales(base, empresa, '2025-01-01', r.lineas);
    expect(numeroLocal).toMatch(/^SI-LOCAL-/);
    expect((await sync()).contabilizados).toBe(1);
  });

  it('reporta errores por fila y acepta coma como separador', async () => {
    const { base } = await nuevoPC();
    const csv = ['cuenta,nit_tercero,debito,credito', '1105,,100,0', '999999,,1,0', '130505,,5,0', '130505,123456789,5,0', '111005,,abc,0', '111005,,0,0', '111005,,250.5,0'].join('\n');
    const r = await leerSaldosIniciales(base, empresa, csv);
    expect(r.errores).toEqual([
      'Fila 2: la cuenta 1105 no es auxiliar.',
      'Fila 3: la cuenta "999999" no existe.',
      'Fila 4: la cuenta 130505 exige tercero.',
      'Fila 5: no existe un tercero con documento 123456789. Créelo primero.',
      'Fila 6: valores inválidos ("abc", "0").',
    ]);
    expect(r.lineas).toEqual([expect.objectContaining({ cuenta: '111005', debito: $('250.50') })]);
    await expect(crearSaldosIniciales(base, empresa, '2025-01-01', r.lineas)).rejects.toThrow(ErrorMotor); // descuadrado
  });
});

describe('cierres', () => {
  it('resumen por mes con pendientes sin número oficial', async () => {
    const { base } = await nuevoPC();
    await crearComprobante(base, empresa, { tipo: 'CG', fecha: '2026-03-10', concepto: 'x', lineas: [D('519595', '100'), C('111005', '100')] });
    const r = await resumenPeriodos(base, empresa, 2026);
    expect(r).toHaveLength(12);
    expect(r[2]).toMatchObject({ mes: 3, estado: 'abierto', comprobantes: 1, pendientes: 1 });
  });

  it('cierre anual: exige sincronizar antes, lleva la utilidad a 3605, deja en cero las clases 4 a 7 y no se duplica', async () => {
    const { base, sync } = await nuevoPC();
    await crearComprobante(base, empresa, { tipo: 'CG', fecha: '2026-05-10', concepto: 'Venta', lineas: [D('111005', '1000000'), C('413595', '1000000')] });
    await crearComprobante(base, empresa, { tipo: 'CG', fecha: '2026-06-10', concepto: 'Gasto', lineas: [D('519595', '300000'), C('111005', '300000')] });
    await expect(generarCierreAnual(base, empresa, 2026)).rejects.toThrow(/Sincronice antes/);
    await sync();
    const v = await vistaCierreAnual(base, empresa, 2026);
    expect(v.utilidadNeta).toBe($('700000'));
    const { numeroLocal } = await generarCierreAnual(base, empresa, 2026);
    expect(numeroLocal).toMatch(/^CC-LOCAL-/);
    await expect(generarCierreAnual(base, empresa, 2026)).rejects.toThrow(/Ya existe/);
    await sync();
    const [cc] = await leerComprobantes(base, empresa, { estados: ['contabilizado'] }).then((l) => l.filter((c) => c.origen === 'cierre_anual'));
    expect(cc).toMatchObject({ fecha: '2026-12-31', numero: expect.stringMatching(/^CC-\d{6}$/) });
    const bp = await balancePruebaLocal(base, empresa, { desde: '2026-01-01', hasta: '2026-12-31' }, { nivelMaximo: 4 });
    for (const clase of ['4', '5']) expect(bp.filas.find((f) => f.codigo === clase)?.saldoFinal ?? 0n).toBe(0n);
    expect(bp.filas.find((f) => f.codigo === '360505')!.saldoFinal).toBe(-$('700000')); // utilidad del ejercicio (crédito)
    expect(bp.cuadra).toBe(true);
  });
});
