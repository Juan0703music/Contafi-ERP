import { describe, expect, it } from 'vitest';
import { crearReverso, validarComprobante, balancePrueba, numeroLocal, ErrorMotor } from '../src/index.ts';
import { C, D, comprobante, ctx, CUENTAS, $ } from './ayudas.ts';

const codigos = (c: Parameters<typeof validarComprobante>[0], cerrados: string[] = []) =>
  validarComprobante(c, ctx(cerrados)).map((e) => e.codigo);

describe('reglas del comprobante (sección 8)', () => {
  const base = { fecha: '2026-09-30', concepto: 'Aporte de capital' };

  it('acepta un comprobante válido', () => {
    expect(codigos({ ...base, lineas: [D('111005', '1000000'), C('310505', '1000000')] })).toEqual([]);
  });
  it('regla 1: descuadrado, total cero y menos de dos líneas', () => {
    expect(codigos({ ...base, lineas: [D('111005', '100'), C('310505', '99')] })).toContain('DESCUADRADO');
    expect(codigos({ ...base, lineas: [D('111005', '100')] })).toEqual(expect.arrayContaining(['MENOS_DE_DOS_LINEAS', 'DESCUADRADO']));
  });
  it('regla 2: débito y crédito en la misma línea, negativos y líneas en cero', () => {
    expect(codigos({ ...base, lineas: [{ cuenta: '111005', debito: 5n, credito: 5n }, C('310505', '0.00')] }))
      .toEqual(expect.arrayContaining(['DEBITO_Y_CREDITO', 'LINEA_EN_CERO']));
    expect(codigos({ ...base, lineas: [{ cuenta: '111005', debito: -5n, credito: 0n }, { cuenta: '310505', debito: -5n, credito: 0n }] }))
      .toContain('VALOR_NEGATIVO');
  });
  it('regla 3: solo auxiliares, tercero obligatorio, cuenta existente', () => {
    expect(codigos({ ...base, lineas: [D('1105', '100'), C('310505', '100')] })).toContain('CUENTA_NO_ACEPTA_MOVIMIENTO');
    expect(codigos({ ...base, lineas: [D('130505', '100', null), C('413595', '100')] })).toContain('FALTA_TERCERO');
    expect(codigos({ ...base, lineas: [D('999999', '100'), C('413595', '100')] })).toContain('CUENTA_INEXISTENTE');
  });
  it('regla 4: no se contabiliza en período cerrado', () => {
    expect(codigos({ ...base, lineas: [D('111005', '100'), C('310505', '100')] }, ['2026-09'])).toContain('PERIODO_CERRADO');
    expect(codigos({ ...base, fecha: '2026-10-01', lineas: [D('111005', '100'), C('310505', '100')] }, ['2026-09'])).toEqual([]);
  });
  it('rechaza fechas inválidas y concepto vacío', () => {
    expect(codigos({ fecha: '2026-02-30', concepto: ' ', lineas: [D('111005', '1'), C('310505', '1')] }))
      .toEqual(expect.arrayContaining(['FECHA_INVALIDA', 'CONCEPTO_VACIO']));
  });
});

describe('regla 6: anulación con reverso', () => {
  it('el reverso neutraliza el original en los reportes y exige motivo', () => {
    const original = comprobante('2026-09-10', [D('519595', '250000', 'T9'), C('111005', '250000', 'T9')]);
    expect(() => crearReverso(original, { id: 'r', fecha: '2026-09-11', motivo: ' ' })).toThrow(ErrorMotor);
    const reverso = { ...crearReverso(original, { id: 'r1', fecha: '2026-09-11', motivo: 'Registrado dos veces' }), estado: 'contabilizado' as const };
    expect(reverso.reversaDe).toBe(original.id);
    expect(reverso.lineas[0]).toMatchObject({ cuenta: '519595', debito: 0n, credito: $('250000'), terceroId: 'T9' });
    const anulado = { ...original, estado: 'anulado' as const };
    const bp = balancePrueba(CUENTAS, [anulado, reverso], { desde: '2026-09-01', hasta: '2026-09-30' });
    expect(bp.cuadra).toBe(true);
    expect(bp.filas.find((f) => f.codigo === '519595')?.saldoFinal).toBe(0n);
    expect(() => crearReverso(anulado, { id: 'r2', fecha: '2026-09-12', motivo: 'x' })).toThrow(/ya está anulado/);
  });
  it('no anula borradores', () => {
    const b = comprobante('2026-09-10', [D('519595', '1'), C('111005', '1')], { estado: 'borrador' });
    expect(() => crearReverso(b, { id: 'r', fecha: '2026-09-10', motivo: 'x' })).toThrow(/Solo se anulan/);
  });
});

describe('numeración', () => {
  it('número local temporal para comprobantes sin conexión', () => {
    expect(numeroLocal('CG', '7f3a91c2-0000-4000-8000-000000000000')).toBe('CG-LOCAL-7F3A');
  });
});
