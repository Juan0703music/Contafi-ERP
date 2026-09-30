import { describe, expect, it } from 'vitest';
import {
  aCentavos, leerMontoUsuario, aDecimal, aplicarTarifa, dividirRedondeado, formatoCOP, prorratear,
  hoyBogota, periodoDe, esFechaValida, diasEntre,
  calcularDV, validarNitConDV, formatearNit,
  PUC_SEMILLA, aceptaMovimientoEnPlantilla, codigoPadre, CUENTAS_POR_DEFECTO,
} from '../src/index.ts';

describe('dinero', () => {
  it('convierte texto a centavos sin punto flotante', () => {
    expect(aCentavos('1234567.89')).toBe(123456789n);
    expect(aCentavos('1.234.567,89')).toBe(123456789n);
    expect(aCentavos('0.1')).toBe(10n);
    expect(aCentavos('-15.5')).toBe(-1550n);
    expect(aCentavos(250000)).toBe(25000000n);
    expect(aCentavos('10.005')).toBe(1001n); // mitad hacia arriba
    expect(aCentavos('10.0049')).toBe(1000n);
  });
  it('rechaza números con decimales (se deben pasar como texto)', () => {
    expect(() => aCentavos(0.1)).toThrow();
  });
  it('0,1 + 0,2 = 0,3 exacto', () => {
    expect(aCentavos('0.1') + aCentavos('0.2')).toBe(aCentavos('0.3'));
  });
  it('redondea mitad alejándose de cero', () => {
    expect(dividirRedondeado(5n, 2n)).toBe(3n);
    expect(dividirRedondeado(-5n, 2n)).toBe(-3n);
    expect(dividirRedondeado(4n, 3n)).toBe(1n);
  });
  it('aplica tarifas en millonésimas', () => {
    expect(aplicarTarifa(aCentavos('100000'), 190_000n)).toBe(aCentavos('19000'));
    // ReteICA 4,14 por mil sobre $1.234.567 = 5.111,107... -> 5.111,11
    expect(aplicarTarifa(aCentavos('1234567'), 4_140n)).toBe(aCentavos('5111.11'));
  });
  it('formatea', () => {
    expect(aDecimal(123456789n)).toBe('1234567.89');
    expect(aDecimal(-5n)).toBe('-0.05');
    expect(formatoCOP(123456789n)).toBe('$ 1.234.567,89');
    expect(formatoCOP(-100000n, { decimales: false })).toBe('-$ 1.000');
  });
  it('prorratea sin perder centavos', () => {
    const partes = prorratear(10000n, [1n, 1n, 1n]);
    expect(partes).toEqual([3333n, 3333n, 3334n]);
  });
});

describe('montos escritos por el usuario', () => {
  it('interpreta el punto como separador de miles cuando corresponde', () => {
    expect(leerMontoUsuario('1.234')).toBe(123400n);
    expect(leerMontoUsuario('1.234.567')).toBe(123456700n);
    expect(leerMontoUsuario('$ 1.234.567,89')).toBe(123456789n);
    expect(leerMontoUsuario('1234567,89')).toBe(123456789n);
    expect(leerMontoUsuario('1234567.89')).toBe(123456789n);
    expect(leerMontoUsuario('1.5')).toBe(150n);
    expect(leerMontoUsuario('250000')).toBe(25000000n);
    expect(leerMontoUsuario('0,5')).toBe(50n);
  });
  it('rechaza lo que no es un monto', () => {
    for (const x of ['', 'abc', '1,2,3', '12.34.5', '1.23.456', '--5']) expect(leerMontoUsuario(x), x).toBeNull();
  });
});

describe('fechas (zona America/Bogota)', () => {
  it('corrige el error UTC del prototipo: 8 p. m. en Colombia sigue siendo el mismo día', () => {
    // 2026-09-30 20:00 en Bogotá = 2026-10-01 01:00 UTC
    const instante = new Date('2026-10-01T01:00:00Z');
    expect(instante.toISOString().slice(0, 10)).toBe('2026-10-01'); // lo que hacía el prototipo
    expect(hoyBogota(instante)).toBe('2026-09-30');
  });
  it('valida fechas y periodos', () => {
    expect(esFechaValida('2026-02-29')).toBe(false);
    expect(esFechaValida('2028-02-29')).toBe(true);
    expect(periodoDe('2026-09-30')).toBe('2026-09');
    expect(() => periodoDe('2026-13-01')).toThrow();
    expect(diasEntre('2026-01-01', '2026-03-02')).toBe(60);
  });
});

describe('NIT', () => {
  it('calcula el dígito de verificación', () => {
    expect(calcularDV('800197268')).toBe(4); // DIAN
    expect(calcularDV('860.034.313')).toBe(7); // Davivienda
    expect(calcularDV('890903938')).toBe(8); // Bancolombia
    expect(validarNitConDV('800.197.268-4')).toBe(true);
    expect(validarNitConDV('800.197.268-5')).toBe(false);
    expect(formatearNit('800197268')).toBe('800.197.268-4');
  });
});

describe('PUC semilla', () => {
  it('no tiene códigos repetidos y cada cuenta tiene padre', () => {
    const codigos = new Set(PUC_SEMILLA.map((c) => c.codigo));
    expect(codigos.size).toBe(PUC_SEMILLA.length);
    for (const c of PUC_SEMILLA) {
      const p = codigoPadre(c.codigo);
      if (p) expect(codigos.has(p), `falta el padre de ${c.codigo}`).toBe(true);
    }
  });
  it('las cuentas por defecto existen y aceptan movimiento', () => {
    for (const codigo of Object.values(CUENTAS_POR_DEFECTO)) {
      expect(PUC_SEMILLA.some((c) => c.codigo === codigo), codigo).toBe(true);
      expect(aceptaMovimientoEnPlantilla(codigo), codigo).toBe(true);
    }
    expect(aceptaMovimientoEnPlantilla('1105')).toBe(false);
  });
});
