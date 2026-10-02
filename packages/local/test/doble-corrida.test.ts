import { describe, expect, it } from 'vitest';
import { aCentavos as $ } from '@contafi/shared';
import { leerBalanceExterno, leerMontoExportado } from '../src/index.ts';

describe('balance del software anterior (doble corrida)', () => {
  it('entiende los montos como los exportan los programas', () => {
    expect(['1.234.567,89', '1,234,567.89', '1234567.89', '-1.234', '(1.234)', '$ 1.234', '1.234-', '12,5', '', 'abc'].map(leerMontoExportado))
      .toEqual([$('1234567.89'), $('1234567.89'), $('1234567.89'), -$('1234'), -$('1234'), $('1234'), -$('1234'), $('12.5'), 0n, null]);
  });

  it('saldo según naturaleza: las cuentas crédito se pasan a débito − crédito; ignora títulos y totales', () => {
    const csv = ['Código;Nombre de la cuenta;Saldo anterior;Débitos;Créditos;Saldo final', '1;ACTIVO;0;0;0;55.000.000',
      '110505;Caja general;0;5.000.000;0;5.000.000', '240805;IVA generado;0;0;190.000;190.000', '1592;Depreciación acumulada;;;;-1.000,00',
      'TOTALES;;;;;0'].join('\n');
    const r = leerBalanceExterno(csv, 'naturaleza');
    expect(r.errores).toEqual([]);
    expect(r.columnas).toBe('saldo');
    expect(r.filas.map((f) => [f.cuenta, f.saldo])).toEqual([['1', $('55000000')], ['110505', $('5000000')], ['240805', -$('190000')], ['1592', -$('1000')]]);
    expect(r.filas[1]!.nombre).toBe('Caja general');
    // La naturaleza del PUC de la empresa manda (1592 es crédito aunque sea clase 1)
    const conPuc = leerBalanceExterno('cuenta;nombre;saldo\n1592;Depreciación;1.000', 'naturaleza', new Map([['1592', 'C' as const]]));
    expect(conPuc.filas[0]!.saldo).toBe(-$('1000'));
    expect(leerBalanceExterno('cuenta;nombre;saldo\n240805;IVA;-190.000', 'debito-credito').filas[0]!.saldo).toBe(-$('190000'));
  });

  it('dos columnas (saldo débito y saldo crédito), separador tabulador o coma, y errores por fila', () => {
    const r = leerBalanceExterno(['Cuenta\tDescripción\tSaldo débito\tSaldo crédito', '1105.05\tCaja\t5.000.000\t0', '2408-05\tIVA\t0\t190.000', '1305\tClientes\tx\t0'].join('\n'), 'naturaleza');
    expect(r.columnas).toBe('debito-credito');
    expect(r.filas.map((f) => [f.cuenta, f.saldo])).toEqual([['110505', $('5000000')], ['240805', -$('190000')]]);
    expect(r.errores).toEqual(['Fila 4: no se entiende el saldo de la cuenta 1305.']);
    expect(leerBalanceExterno('110505,Caja,"5000000"', 'naturaleza').filas).toEqual([{ cuenta: '110505', nombre: 'Caja', saldo: $('5000000') }]);
  });
});
