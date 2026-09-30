import { esFechaValida, formatoCOP, periodoDe, type FechaISO } from '@contafi/shared';
import { ErrorMotor, type ErrorContable } from './errores.ts';
import type { Comprobante, ContextoContable, Linea } from './tipos.ts';

export function totales(lineas: readonly Linea[]): { debitos: bigint; creditos: bigint } {
  let debitos = 0n;
  let creditos = 0n;
  for (const l of lineas) {
    debitos += l.debito;
    creditos += l.credito;
  }
  return { debitos, creditos };
}

/**
 * Reglas 1 a 4 de la sección 8. Devuelve TODOS los errores encontrados (lista vacía = válido).
 * La regla 5 (consecutivo) y la 6 (inmutabilidad) las garantiza el servidor y la base de datos.
 */
export function validarComprobante(
  c: Pick<Comprobante, 'fecha' | 'concepto' | 'lineas'>,
  ctx: ContextoContable,
): ErrorContable[] {
  const errores: ErrorContable[] = [];

  if (!c.concepto || c.concepto.trim() === '') {
    errores.push({ codigo: 'CONCEPTO_VACIO', mensaje: 'El comprobante debe tener un concepto.' });
  }

  if (!esFechaValida(c.fecha)) {
    errores.push({ codigo: 'FECHA_INVALIDA', mensaje: `La fecha "${c.fecha}" no es válida.` });
  } else if (ctx.periodoCerrado(periodoDe(c.fecha))) {
    errores.push({
      codigo: 'PERIODO_CERRADO',
      mensaje: `El período ${periodoDe(c.fecha)} está cerrado. No se pueden registrar comprobantes en esa fecha.`,
    });
  }

  if (c.lineas.length < 2) {
    errores.push({ codigo: 'MENOS_DE_DOS_LINEAS', mensaje: 'El comprobante debe tener al menos dos líneas.' });
  }

  c.lineas.forEach((l, i) => {
    const n = i + 1;
    if (l.debito < 0n || l.credito < 0n) {
      errores.push({ codigo: 'VALOR_NEGATIVO', linea: i, mensaje: `Línea ${n}: los valores no pueden ser negativos.` });
    }
    if (l.debito !== 0n && l.credito !== 0n) {
      errores.push({ codigo: 'DEBITO_Y_CREDITO', linea: i, mensaje: `Línea ${n}: tiene débito y crédito a la vez.` });
    }
    if (l.debito === 0n && l.credito === 0n) {
      errores.push({ codigo: 'LINEA_EN_CERO', linea: i, mensaje: `Línea ${n}: no tiene valor.` });
    }
    const cuenta = ctx.cuenta(l.cuenta);
    if (!cuenta) {
      errores.push({ codigo: 'CUENTA_INEXISTENTE', linea: i, mensaje: `Línea ${n}: la cuenta ${l.cuenta} no existe.` });
      return;
    }
    if (!cuenta.aceptaMovimiento) {
      errores.push({
        codigo: 'CUENTA_NO_ACEPTA_MOVIMIENTO', linea: i,
        mensaje: `Línea ${n}: la cuenta ${cuenta.codigo} ${cuenta.nombre} no es auxiliar y no recibe movimientos.`,
      });
    }
    if (!cuenta.activa) {
      errores.push({ codigo: 'CUENTA_INACTIVA', linea: i, mensaje: `Línea ${n}: la cuenta ${cuenta.codigo} está inactiva.` });
    }
    if (cuenta.exigeTercero && !l.terceroId) {
      errores.push({ codigo: 'FALTA_TERCERO', linea: i, mensaje: `Línea ${n}: la cuenta ${cuenta.codigo} exige tercero.` });
    }
    if (cuenta.exigeCentroCosto && !l.centroCostoId) {
      errores.push({
        codigo: 'FALTA_CENTRO_COSTO', linea: i, mensaje: `Línea ${n}: la cuenta ${cuenta.codigo} exige centro de costo.`,
      });
    }
  });

  const { debitos, creditos } = totales(c.lineas);
  if (debitos !== creditos) {
    errores.push({
      codigo: 'DESCUADRADO',
      mensaje: `El comprobante no está balanceado: débitos ${formatoCOP(debitos)} ≠ créditos ${formatoCOP(creditos)}.`,
    });
  } else if (debitos <= 0n) {
    errores.push({ codigo: 'TOTAL_CERO', mensaje: 'El comprobante no tiene movimientos.' });
  }

  return errores;
}

export function asegurarValido(c: Pick<Comprobante, 'fecha' | 'concepto' | 'lineas'>, ctx: ContextoContable): void {
  const errores = validarComprobante(c, ctx);
  if (errores.length > 0) throw new ErrorMotor(errores);
}

/**
 * Regla 6: un comprobante contabilizado no se edita; se anula con un reverso.
 * El reverso intercambia débitos y créditos, conserva terceros y centros de costo, y apunta al original.
 */
export function crearReverso(
  original: Comprobante,
  datos: { id: string; fecha: FechaISO; motivo: string; tipo?: string },
): Comprobante {
  if (original.estado === 'anulado') {
    throw new ErrorMotor([{ codigo: 'YA_ANULADO', mensaje: `El comprobante ${original.numero} ya está anulado.` }]);
  }
  if (original.estado !== 'contabilizado') {
    throw new ErrorMotor([{
      codigo: 'NO_CONTABILIZADO',
      mensaje: 'Solo se anulan comprobantes contabilizados. Un borrador se puede editar o descartar.',
    }]);
  }
  if (!datos.motivo.trim()) {
    throw new ErrorMotor([{ codigo: 'DATO_INVALIDO', mensaje: 'La anulación exige un motivo.' }]);
  }
  return {
    id: datos.id,
    empresaId: original.empresaId,
    tipo: datos.tipo ?? original.tipo,
    numero: null,
    fecha: datos.fecha,
    concepto: `Anulación de ${original.numero ?? original.id} — ${datos.motivo.trim()}`,
    estado: 'borrador',
    origen: 'reverso',
    reversaDe: original.id,
    lineas: original.lineas.map((l) => ({ ...l, debito: l.credito, credito: l.debito })),
  };
}

/** Número local temporal para comprobantes hechos sin conexión (sección 9.1): "CG-LOCAL-7F3A". */
export function numeroLocal(tipo: string, id: string): string {
  return `${tipo}-LOCAL-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

export function formatearConsecutivo(prefijo: string, n: number | bigint): string {
  return `${prefijo}-${String(n).padStart(6, '0')}`;
}
