import { PUC_SEMILLA, aceptaMovimientoEnPlantilla, aCentavos, type FechaISO } from '@contafi/shared';
import { contextoDesdeCuentas, type Comprobante, type Cuenta, type Linea } from '../src/index.ts';

export const CUENTAS: Cuenta[] = PUC_SEMILLA.map((c) => ({
  codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza,
  aceptaMovimiento: aceptaMovimientoEnPlantilla(c.codigo),
  exigeTercero: c.exigeTercero, exigeCentroCosto: false, activa: true,
}));

export const AUXILIARES = CUENTAS.filter((c) => c.aceptaMovimiento);

export const ctx = (cerrados: string[] = []) => contextoDesdeCuentas(CUENTAS, cerrados);

export const $ = (s: string) => aCentavos(s);

export const D = (cuenta: string, valor: string, terceroId: string | null = 'T1'): Linea =>
  ({ cuenta, terceroId, debito: $(valor), credito: 0n });
export const C = (cuenta: string, valor: string, terceroId: string | null = 'T1'): Linea =>
  ({ cuenta, terceroId, debito: 0n, credito: $(valor) });

let n = 0;
export function comprobante(fecha: FechaISO, lineas: Linea[], extra: Partial<Comprobante> = {}): Comprobante {
  n++;
  return {
    id: `c${n}`, empresaId: 'E1', tipo: 'CG', numero: `CG-${String(n).padStart(6, '0')}`,
    fecha, concepto: `Prueba ${n}`, estado: 'contabilizado', origen: 'manual', lineas, ...extra,
  };
}
