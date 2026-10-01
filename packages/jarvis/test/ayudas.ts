import { DatabaseSync } from 'node:sqlite';
import { aCentavos as $, PUC_SEMILLA, aceptaMovimientoEnPlantilla, nivelPuc, formatearNit } from '@contafi/shared';
import { formatearConsecutivo, type Linea } from '@contafi/motor';
import { migrar, guardarEmpresas, crearComprobante, crearTercero, s, type BaseLocal, type Sentencia, type ValorSql } from '@contafi/local';

export const EMPRESA = { id: 'e1', firma_id: 'f1', nit: '900123456', dv: 8, razon_social: 'Comercializadora Andina S.A.S.' };
export const HOY = '2026-09-30';
void formatearNit;

export function baseMemoria(): BaseLocal {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys = on');
  return {
    async consultar<T>(sql: string, p: ValorSql[] = []) { return db.prepare(sql).all(...p) as T[]; },
    async lote(ss: Sentencia[]) {
      db.exec('begin');
      try { for (const x of ss) db.prepare(x.sql).run(...(x.params ?? [])); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
    },
  };
}

const D = (cuenta: string, v: string, t: string | null = null): Linea => ({ cuenta, debito: $(v), credito: 0n, terceroId: t });
const C = (cuenta: string, v: string, t: string | null = null): Linea => ({ cuenta, debito: 0n, credito: $(v), terceroId: t });

/** Empresa con movimientos conocidos de enero a septiembre de 2026, todos contabilizados. */
export async function empresaDePrueba(): Promise<BaseLocal> {
  const base = baseMemoria();
  await migrar(base);
  await guardarEmpresas(base, [EMPRESA]);
  const e = EMPRESA.id;
  await base.lote([
    ...PUC_SEMILLA.map((c) => s(`insert into cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa) values (?, ?, ?, ?, ?, ?, ?, 0, 1)`, e, c.codigo, c.nombre, c.naturaleza, nivelPuc(c.codigo), aceptaMovimientoEnPlantilla(c.codigo), c.exigeTercero)),
    ...['SI', 'FV', 'FC', 'RC', 'CE', 'CG'].map((t) => s('insert into tipos_comprobante values (?, ?, ?, ?)', e, t, t, t)),
  ]);
  const roble = await crearTercero(base, e, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Distribuciones El Roble S.A.S.', tipos: ['cliente'] });
  const norte = await crearTercero(base, e, { tipo_doc: '31', numero: '901223556', dv: 9, nombre: 'Importadora Suministros del Norte S.A.S.', tipos: ['proveedor'] });
  const movimientos: [string, string, string, Linea[]][] = [
    ['SI', '2026-01-02', 'Saldos iniciales', [D('111005', '50000000'), D('110505', '5000000'), C('310505', '55000000')]],
    ['FC', '2026-01-15', 'Compra de mercancía SN-10321', [D('143505', '18000000', norte), D('240810', '3420000', norte), C('220505', '20970000', norte), C('236540', '450000', norte)]],
    ['FV', '2026-02-10', 'Venta FE-1001 a El Roble', [D('130505', '29750000', roble), C('413595', '25000000', roble), C('240805', '4750000', roble)]],
    ['RC', '2026-03-05', 'Recaudo parcial FE-1001', [D('111005', '9750000', roble), C('130505', '9750000', roble)]],
    ['CG', '2026-03-31', 'Arriendo de oficina marzo', [D('512010', '3200000', norte), C('111005', '3200000')]],
    ['CG', '2026-06-30', 'Arriendo de oficina junio', [D('512010', '3200000', norte), C('111005', '3200000')]],
    ['CG', '2026-07-31', 'Arriendo de oficina julio', [D('512010', '3200000', norte), C('111005', '3200000')]],
    ['CG', '2026-08-31', 'Arriendo de oficina agosto', [D('512010', '3200000', norte), C('111005', '3200000')]],
    ['CG', '2026-09-15', 'Arriendo de oficina septiembre y reparaciones', [D('512010', '9500000', norte), C('111005', '9500000')]],
    ['FV', '2026-09-20', 'Venta FE-1002 a El Roble', [D('130505', '11900000', roble), C('413595', '10000000', roble), C('240805', '1900000', roble)]],
  ];
  const n = new Map<string, number>();
  for (const [tipo, fecha, concepto, lineas] of movimientos) {
    const { id } = await crearComprobante(base, e, { tipo, fecha, concepto, lineas });
    n.set(tipo, (n.get(tipo) ?? 0) + 1);
    await base.lote([
      s(`update comprobantes set estado = 'contabilizado', numero = ? where id = ?`, formatearConsecutivo(tipo, n.get(tipo)!), id),
      s('delete from cola_salida'),
    ]);
  }
  await base.lote([s(`insert into estado_sync (empresa_id, ultima_seq, ultima_recepcion) values (?, 0, ?)`, e, '2026-09-30T12:00:00Z')]);
  return base;
}
