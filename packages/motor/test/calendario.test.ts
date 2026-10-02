import { describe, expect, it } from 'vitest';
import { vencimientosEmpresa, type FilaCalendario } from '../src/index.ts';

// FECHAS DE EJEMPLO PARA PRUEBAS: no son las del decreto del calendario tributario.
const fila = (obligacion: string, periodo: string, digito: string | null, fecha: string): FilaCalendario =>
  ({ obligacion, nombre: obligacion, periodo, digito, fecha });
const CAL: FilaCalendario[] = [
  fila('RETENCION', '2026-09', '8', '2026-10-14'),
  fila('RETENCION', '2026-09', '9', '2026-10-15'),
  fila('IVA_BIM', '2026-B5', '8', '2026-11-12'),
  fila('IVA_CUAT', '2026-C2', '8', '2026-09-12'),
  fila('EXOGENA', '2025', null, '2026-10-20'),
  fila('RETENCION', '2026-08', '8', '2026-09-10'),
];

describe('calendario tributario', () => {
  it('filtra por obligaciones de la empresa y último dígito del NIT, en la ventana pedida', () => {
    const v = vencimientosEmpresa({ nit: '900.123.458', obligaciones: ['RETENCION', 'IVA_BIM', 'EXOGENA'] }, CAL, '2026-10-02');
    expect(v.map((x) => [x.obligacion, x.periodo, x.fecha, x.dias])).toEqual([
      ['RETENCION', '2026-09', '2026-10-14', 12],
      ['EXOGENA', '2025', '2026-10-20', 18],
      ['IVA_BIM', '2026-B5', '2026-11-12', 41],
    ]);
  });

  it('no muestra lo ya vencido ni lo que está fuera de la ventana; el NIT 9 tiene su propia fecha', () => {
    expect(vencimientosEmpresa({ nit: '900123459', obligaciones: ['RETENCION'] }, CAL, '2026-10-15', 10).map((x) => [x.fecha, x.dias]))
      .toEqual([['2026-10-15', 0]]);
    expect(vencimientosEmpresa({ nit: '900123458', obligaciones: ['IVA_BIM'] }, CAL, '2026-10-02', 30)).toEqual([]);
    expect(vencimientosEmpresa({ nit: '900123458', obligaciones: [] }, CAL, '2026-10-02')).toEqual([]);
  });
});
