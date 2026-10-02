import { codigoPadre, errorCodigoCuentaNueva, nivelPuc } from '@contafi/shared';
import { s, type BaseLocal, type Sentencia } from './base.ts';
import { ErrorLocal } from './contabilidad.ts';

/**
 * PUC personalizable (sección 11.1). Las cuentas se crean y editan sin conexión y viajan en la cola,
 * antes que los comprobantes que las usan. El servidor aplica las mismas reglas (registrar_cuenta) y
 * es quien decide: si rechaza, la cuenta queda marcada con el motivo.
 */

export interface CuentaPlan {
  codigo: string;
  nombre: string;
  naturaleza: 'D' | 'C';
  nivel: number;
  aceptaMovimiento: boolean;
  exigeTercero: boolean;
  exigeCentroCosto: boolean;
  activa: boolean;
  /** Creada o editada en este PC y todavía sin subir. */
  pendiente: boolean;
  /** Motivo del rechazo del servidor (texto). */
  errorSync: string | null;
  /** false = creada en este PC y el servidor aún no la tiene. */
  enServidor: boolean;
}

export interface DatosCuenta {
  nombre: string;
  exigeTercero?: boolean;
  exigeCentroCosto?: boolean;
  activa?: boolean;
}

export async function planDeCuentas(base: BaseLocal, empresa: string): Promise<CuentaPlan[]> {
  const filas = await base.consultar<Record<string, string | number | null>>(
    `select c.*, exists (select 1 from cola_salida q where q.empresa_id = c.empresa_id and q.tipo = 'cuenta' and q.registro_id = c.codigo) as pendiente
       from cuentas c where c.empresa_id = ? order by c.codigo`, [empresa]);
  return filas.map((c) => ({
    codigo: String(c['codigo']), nombre: String(c['nombre']), naturaleza: c['naturaleza'] as 'D' | 'C', nivel: Number(c['nivel']),
    aceptaMovimiento: !!c['acepta_movimiento'], exigeTercero: !!c['exige_tercero'], exigeCentroCosto: !!c['exige_centro_costo'],
    activa: !!c['activa'], pendiente: !!c['pendiente'], enServidor: !!c['en_servidor'],
    errorSync: c['errores_sync'] == null ? null : (JSON.parse(String(c['errores_sync'])) as { mensaje: string }[]).map((e) => e.mensaje).join(' '),
  }));
}

const encolar = (empresa: string, codigo: string): Sentencia =>
  s(`insert into cola_salida (empresa_id, tipo, registro_id, creado_en) values (?, 'cuenta', ?, ?)
     on conflict (empresa_id, tipo, registro_id) do nothing`, empresa, codigo, new Date().toISOString());

async function tieneMovimientos(base: BaseLocal, empresa: string, codigo: string): Promise<boolean> {
  const [f] = await base.consultar<{ n: number }>(
    `select count(*) as n from lineas l join comprobantes c on c.id = l.comprobante_id
      where c.empresa_id = ? and l.cuenta = ? and c.estado <> 'rechazado'`, [empresa, codigo]);
  return Number(f?.n ?? 0) > 0;
}

function validarNombre(nombre: string): string {
  const n = nombre.trim();
  if (!n || n.length > 200) throw new ErrorLocal('NOMBRE_INVALIDO', 'El nombre de la cuenta es obligatorio (máximo 200 caracteres).');
  return n;
}

/** Crea una cuenta, subcuenta o auxiliar. Hereda la naturaleza del padre; si el padre era auxiliar, deja de serlo. */
export async function crearCuenta(base: BaseLocal, empresa: string, codigo: string, datos: DatosCuenta): Promise<void> {
  const error = errorCodigoCuentaNueva(codigo);
  if (error) throw new ErrorLocal('CODIGO_INVALIDO', error);
  const nombre = validarNombre(datos.nombre);
  const [existe] = await base.consultar<{ nombre: string }>('select nombre from cuentas where empresa_id = ? and codigo = ?', [empresa, codigo]);
  if (existe) throw new ErrorLocal('CUENTA_EXISTE', `La cuenta ${codigo} ya existe: ${existe.nombre}.`);
  const padre = codigoPadre(codigo)!;
  const [p] = await base.consultar<{ naturaleza: string; acepta_movimiento: number; activa: number }>(
    'select naturaleza, acepta_movimiento, activa from cuentas where empresa_id = ? and codigo = ?', [empresa, padre]);
  if (!p) throw new ErrorLocal('SIN_CUENTA_PADRE', `Primero cree la cuenta ${padre}.`);
  if (!p.activa) throw new ErrorLocal('PADRE_INACTIVO', `La cuenta ${padre} está inactiva.`);
  const sentencias: Sentencia[] = [];
  if (p.acepta_movimiento) {
    if (await tieneMovimientos(base, empresa, padre)) {
      throw new ErrorLocal('PADRE_CON_MOVIMIENTOS', `La cuenta ${padre} ya tiene movimientos: sus saldos quedarían en una cuenta de título. Cree la auxiliar en otra subcuenta.`);
    }
    // El servidor hace lo mismo al recibir la cuenta, y el cambio del padre baja a los demás PC.
    sentencias.push(s('update cuentas set acepta_movimiento = 0 where empresa_id = ? and codigo = ?', empresa, padre));
  }
  sentencias.push(
    s(`insert into cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa, en_servidor)
       values (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      empresa, codigo, nombre, p.naturaleza, nivelPuc(codigo), datos.exigeTercero ? 1 : 0, datos.exigeCentroCosto ? 1 : 0, datos.activa === false ? 0 : 1),
    encolar(empresa, codigo),
  );
  await base.lote(sentencias);
}

/** Cambia nombre, exigencias o estado. El código, la naturaleza y el nivel no cambian. */
export async function editarCuenta(base: BaseLocal, empresa: string, codigo: string, datos: DatosCuenta): Promise<void> {
  if (codigo.length <= 2) throw new ErrorLocal('CODIGO_INVALIDO', 'Las clases y los grupos los fija el PUC (Decreto 2650); no se modifican.');
  const nombre = validarNombre(datos.nombre);
  const [actual] = await base.consultar<{ activa: number }>('select activa from cuentas where empresa_id = ? and codigo = ?', [empresa, codigo]);
  if (!actual) throw new ErrorLocal('NO_EXISTE', `La cuenta ${codigo} no existe.`);
  const activa = datos.activa !== false;
  if (actual.activa && !activa) {
    const [hijas] = await base.consultar<{ n: number }>(
      `select count(*) as n from cuentas where empresa_id = ? and activa = 1 and codigo like ? || '%' and codigo <> ?`, [empresa, codigo, codigo]);
    if (Number(hijas?.n) > 0) throw new ErrorLocal('TIENE_SUBCUENTAS', `Inactive primero las subcuentas de ${codigo}.`);
    const [saldo] = await base.consultar<{ s: string }>(
      `select cast(coalesce(sum(l.debito - l.credito), 0) as text) as s from lineas l join comprobantes c on c.id = l.comprobante_id
        where c.empresa_id = ? and l.cuenta = ? and c.estado <> 'rechazado'`, [empresa, codigo]);
    if (BigInt(saldo?.s ?? '0') !== 0n) throw new ErrorLocal('CUENTA_CON_SALDO', `La cuenta ${codigo} tiene saldo: trasládelo antes de inactivarla.`);
  }
  await base.lote([
    s(`update cuentas set nombre = ?, exige_tercero = ?, exige_centro_costo = ?, activa = ?, errores_sync = null
        where empresa_id = ? and codigo = ?`,
      nombre, datos.exigeTercero ? 1 : 0, datos.exigeCentroCosto ? 1 : 0, activa ? 1 : 0, empresa, codigo),
    encolar(empresa, codigo),
  ]);
}

/**
 * Tras un rechazo: si la cuenta solo existe en este PC, se elimina (y su padre vuelve a ser auxiliar si
 * quedó sin subcuentas); si existe en el servidor, ya tiene los datos de allá y solo se quita el aviso.
 */
export async function descartarCuentaRechazada(base: BaseLocal, empresa: string, codigo: string): Promise<void> {
  const [c] = await base.consultar<{ en_servidor: number; errores_sync: string | null }>(
    'select en_servidor, errores_sync from cuentas where empresa_id = ? and codigo = ?', [empresa, codigo]);
  if (!c?.errores_sync) throw new ErrorLocal('SIN_RECHAZO', `La cuenta ${codigo} no tiene un rechazo pendiente.`);
  if (c.en_servidor) {
    await base.lote([s('update cuentas set errores_sync = null where empresa_id = ? and codigo = ?', empresa, codigo)]);
    return;
  }
  if (await tieneMovimientos(base, empresa, codigo)) {
    throw new ErrorLocal('CUENTA_CON_MOVIMIENTOS', `Hay comprobantes con la cuenta ${codigo}: cámbielos de cuenta antes de descartarla.`);
  }
  await base.lote(sentenciasQuitarCuentaLocal(empresa, codigo));
}

/** Quita una cuenta que solo existe en el PC y recalcula si su padre recibe movimientos (como en la plantilla). */
export function sentenciasQuitarCuentaLocal(empresa: string, codigo: string): Sentencia[] {
  const padre = codigoPadre(codigo);
  return [
    s('delete from cuentas where empresa_id = ? and codigo = ?', empresa, codigo),
    s(`delete from cola_salida where empresa_id = ? and tipo = 'cuenta' and registro_id = ?`, empresa, codigo),
    ...(padre ? [s(`update cuentas set acepta_movimiento = not exists (
                      select 1 from cuentas h where h.empresa_id = cuentas.empresa_id and h.codigo like cuentas.codigo || '%' and h.codigo <> cuentas.codigo)
                    where empresa_id = ? and codigo = ?`, empresa, padre)] : []),
  ];
}

// ------------------------------------------------------------------ importación (migración asistida)

export const PLANTILLA_PUC = [
  'codigo;nombre;exige_tercero',
  '1205;Acciones;no',
  '120505;Acciones en sociedades nacionales;no',
  '11100501;Bancolombia cuenta corriente 123-456;no',
].join('\r\n');

export interface FilaPuc { codigo: string; nombre: string; exigeTercero: boolean }
export interface LecturaPuc { filas: FilaPuc[]; errores: string[] }

/** Lee el plan de cuentas exportado del software anterior (código, nombre y, opcional, si exige tercero). */
export function leerPucCsv(texto: string): LecturaPuc {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = [';', '\t', ','].find((x) => (lineas[0] ?? '').includes(x)) ?? ';';
  const filas: FilaPuc[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  lineas.forEach((l, i) => {
    const n = i + 1;
    const [cod = '', nombre = '', exige = ''] = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const codigo = cod.replace(/[.\s-]/g, '');
    if (i === 0 && !/^\d/.test(codigo)) return; // encabezado
    if (!/^[1-9]\d*$/.test(codigo) || ![1, 2, 4, 6, 8, 10, 12].includes(codigo.length)) {
      errores.push(`Fila ${n}: código "${cod}" inválido (1, 2, 4, 6, 8, 10 o 12 dígitos).`); return;
    }
    if (!nombre || nombre.length > 200) { errores.push(`Fila ${n}: falta el nombre de la cuenta ${codigo}.`); return; }
    if (vistos.has(codigo)) return; // repetida en el archivo
    vistos.add(codigo);
    filas.push({ codigo, nombre, exigeTercero: /^(s|si|sí|x|1|true)$/i.test(exige) });
  });
  if (!filas.length && !errores.length) errores.push('El archivo no tiene cuentas.');
  return { filas, errores };
}

export interface ResultadoImportacionPuc { creadas: number; existentes: number; errores: string[] }

/**
 * Crea las cuentas que faltan, de padre a hijo, con las mismas reglas que crearCuenta (y sin conexión:
 * viajan al servidor al sincronizar). Las que ya existen se conservan como están.
 */
export async function importarPuc(base: BaseLocal, empresa: string, filas: readonly FilaPuc[]): Promise<ResultadoImportacionPuc> {
  const existentes = new Set((await planDeCuentas(base, empresa)).map((c) => c.codigo));
  const r: ResultadoImportacionPuc = { creadas: 0, existentes: 0, errores: [] };
  const ordenadas = [...filas].sort((a, b) => a.codigo.length - b.codigo.length || a.codigo.localeCompare(b.codigo));
  for (const f of ordenadas) {
    if (existentes.has(f.codigo)) { r.existentes++; continue; }
    if (f.codigo.length <= 2) { r.errores.push(`${f.codigo} ${f.nombre}: las clases y los grupos los fija el PUC; este no existe en el Decreto 2650.`); continue; }
    try {
      await crearCuenta(base, empresa, f.codigo, { nombre: f.nombre, exigeTercero: f.exigeTercero });
      existentes.add(f.codigo);
      r.creadas++;
    } catch (e) {
      r.errores.push(`${f.codigo} ${f.nombre}: ${(e as Error).message}`);
    }
  }
  return r;
}
