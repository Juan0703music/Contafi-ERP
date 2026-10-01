import { describe, expect, it } from 'vitest';
import { aCentavos as $, PUC_SEMILLA, aceptaMovimientoEnPlantilla, nivelPuc } from '@contafi/shared';
import type { Linea } from '@contafi/motor';
import {
  migrar, guardarEmpresas, crearComprobante, leerExtracto, guardarExtracto, estadoConciliacion, conciliarAutomaticamente,
  conciliar, desconciliar, registrarDesdeExtracto, leerComprobantes, s,
} from '../src/index.ts';
import { baseNode } from './ayudas.ts';

const E = 'e1';
const D = (cuenta: string, v: string): Linea => ({ cuenta, debito: $(v), credito: 0n });
const C = (cuenta: string, v: string): Linea => ({ cuenta, debito: 0n, credito: $(v) });

async function empresaLocal() {
  const base = baseNode();
  await migrar(base);
  await guardarEmpresas(base, [{ id: E, firma_id: 'f', nit: '900123456', dv: 8, razon_social: 'Andina' }]);
  await base.lote([
    ...PUC_SEMILLA.map((c) => s(`insert into cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa) values (?, ?, ?, ?, ?, ?, ?, 0, 1)`, E, c.codigo, c.nombre, c.naturaleza, nivelPuc(c.codigo), aceptaMovimientoEnPlantilla(c.codigo), c.exigeTercero)),
    ...['CG', 'SI', 'CE', 'RC'].map((t) => s('insert into tipos_comprobante values (?, ?, ?, ?)', E, t, t, t)),
  ]);
  return base;
}

describe('lectura de extractos bancarios', () => {
  it('valor con signo, ";" y fechas dd/mm/aaaa, con paréntesis como negativo', () => {
    const r = leerExtracto('Fecha;Descripción;Referencia;Valor\n03/09/2026;Consignación;123;1.000.000\n30/09/2026;Comisión;;(12.000)\n31/09/2026;Mala;;5');
    expect(r.movimientos).toEqual([
      { fecha: '2026-09-03', descripcion: 'Consignación', referencia: '123', valor: $('1000000') },
      { fecha: '2026-09-30', descripcion: 'Comisión', referencia: null, valor: -$('12000') },
    ]);
    expect(r.errores).toEqual(['Fila 4: fecha inválida "31/09/2026".']);
  });
  it('columnas de débito y crédito, ","  y fechas aaaa-mm-dd', () => {
    const r = leerExtracto('fecha,detalle,debito,credito\n2026-09-10,Cheque 55,250000,0\n2026-09-11,Abono,0,1500.50');
    expect(r.movimientos.map((m) => m.valor)).toEqual([-$('250000'), $('1500.50')]);
  });
  it('rechaza formatos sin fecha o sin valor', () => {
    expect(leerExtracto('a;b\n1;2').errores[0]).toMatch(/No se reconoce/);
  });
});

describe('conciliación bancaria', () => {
  it('empareja, deja explicadas las partidas pendientes, y registra desde el extracto lo que faltaba en libros', async () => {
    const base = await empresaLocal();
    await crearComprobante(base, E, { tipo: 'SI', fecha: '2026-08-31', concepto: 'Saldo inicial', lineas: [D('111005', '5000000'), C('310505', '5000000')] });
    await crearComprobante(base, E, { tipo: 'RC', fecha: '2026-09-02', concepto: 'Consignación cliente', lineas: [D('111005', '1000000'), C('413595', '1000000')] });
    await crearComprobante(base, E, { tipo: 'CE', fecha: '2026-09-09', concepto: 'Cheque 55', lineas: [D('519595', '250000'), C('111005', '250000')] });
    await crearComprobante(base, E, { tipo: 'CE', fecha: '2026-09-20', concepto: 'Cheque 56 (no cobrado)', lineas: [D('519595', '80000'), C('111005', '80000')] });

    const lectura = leerExtracto('fecha;descripcion;valor\n03/09/2026;Consignación;1.000.000\n10/09/2026;Cheque 55;-250.000\n30/09/2026;Comisión;-12.000');
    const id = await guardarExtracto(base, E, '111005', 'extracto-sep.csv', lectura, $('5738000'));
    expect(await conciliarAutomaticamente(base, E, id)).toBe(2);

    let e = await estadoConciliacion(base, E, id);
    expect(e.extracto).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(e.resumen).toMatchObject({ saldoLibros: $('5670000'), saldoExtracto: $('5738000'), bancoSinRegistrar: -$('12000'), librosEnTransito: -$('80000'), diferencia: 0n });

    // Manual: deshacer y rehacer una pareja
    const cheque = e.banco.find((b) => b.descripcion === 'Cheque 55')!;
    await desconciliar(base, cheque.id);
    expect((await estadoConciliacion(base, E, id)).banco.find((b) => b.id === cheque.id)!.conciliadoCon).toBeNull();
    await conciliar(base, cheque.id, cheque.conciliadoCon!);

    // La comisión solo estaba en el banco: se registra y queda conciliada en la misma transacción
    const comision = e.banco.find((b) => b.descripcion === 'Comisión')!;
    const { numeroLocal } = await registrarDesdeExtracto(base, E, id, comision.id, '530505');
    expect(numeroLocal).toMatch(/^CE-LOCAL-/);
    e = await estadoConciliacion(base, E, id);
    expect(e.banco.every((b) => b.conciliadoCon)).toBe(true);
    expect(e.resumen).toMatchObject({ bancoSinRegistrar: 0n, librosEnTransito: -$('80000'), diferencia: 0n });
    const gasto = (await leerComprobantes(base, E)).find((c) => c.concepto === 'Extracto: Comisión')!;
    expect(gasto.lineas).toEqual([
      expect.objectContaining({ cuenta: '111005', credito: $('12000') }),
      expect.objectContaining({ cuenta: '530505', debito: $('12000') }),
    ]);
    await expect(registrarDesdeExtracto(base, E, id, comision.id, '530505')).rejects.toThrow(/ya está conciliado/);
  });
});

describe('panel multi-empresa', async () => {
  const { resumenEmpresa } = await import('../src/index.ts');
  it('resume pendientes, meses terminados sin cerrar y alertas por empresa', async () => {
    const base = await empresaLocal();
    for (const mes of ['02', '03', '05']) {
      await crearComprobante(base, E, { tipo: 'CG', fecha: `2026-${mes}-10`, concepto: 'x', lineas: [D('111005', '1000'), C('413595', '1000')] });
    }
    await base.lote([s(`insert into periodos values (?, 2026, 2, 'cerrado')`, E)]);
    const r = await resumenEmpresa(base, E, '2026-06-15', new Date('2026-06-15T12:00:00Z'));
    expect(r.mesesSinCerrar).toEqual([3, 5]);
    expect(r.comprobantesAnio).toBe(3);
    expect(r.utilidadAnio).toBe(0n); // pendientes de sincronizar: no cuentan como oficiales
    expect(r.alertas).toEqual(['Nunca se ha sincronizado', '2 meses sin cerrar']);
  });
});
