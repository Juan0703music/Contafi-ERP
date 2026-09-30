import { PUC_SEMILLA, aceptaMovimientoEnPlantilla, aCentavos, nivelPuc } from '@contafi/shared';
import { validarComprobante, formatearConsecutivo, type Linea } from '@contafi/motor';
import {
  migrar, guardarEmpresas, crearTercero, crearComprobante, contextoLocal, s,
  type BaseLocal, type EmpresaLocal, type Transporte,
} from '@contafi/local';
import { VERSION_PROTOCOLO, type ResultadoItem } from '@contafi/sync';

export const EMPRESA_DEMO: EmpresaLocal = {
  id: '00000000-0000-4000-8000-0000000000d1',
  firma_id: '00000000-0000-4000-8000-0000000000d0',
  nit: '900123456',
  dv: 8,
  razon_social: 'Comercializadora Andina S.A.S.',
};

const TIPOS = [
  ['CG', 'Comprobante general'], ['SI', 'Saldos iniciales'], ['FV', 'Factura de venta'], ['FC', 'Factura de compra'],
  ['NC', 'Nota crédito'], ['ND', 'Nota débito'], ['RC', 'Recibo de caja'], ['CE', 'Comprobante de egreso'], ['CC', 'Comprobante de cierre'],
] as const;

const $ = aCentavos;
const D = (cuenta: string, v: string, terceroId: string | null = null): Linea => ({ cuenta, debito: $(v), credito: 0n, terceroId });
const C = (cuenta: string, v: string, terceroId: string | null = null): Linea => ({ cuenta, debito: 0n, credito: $(v), terceroId });

/** Crea la base de demostración: PUC, tipos, terceros y unos movimientos ya "sincronizados". */
export async function sembrarDemo(base: BaseLocal): Promise<void> {
  await migrar(base);
  await guardarEmpresas(base, [EMPRESA_DEMO]);
  const e = EMPRESA_DEMO.id;
  await base.lote([
    ...PUC_SEMILLA.map((c) => s(
      `insert into cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa)
       values (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      e, c.codigo, c.nombre, c.naturaleza, nivelPuc(c.codigo), aceptaMovimientoEnPlantilla(c.codigo), c.exigeTercero)),
    ...TIPOS.map(([codigo, nombre]) => s('insert into tipos_comprobante (empresa_id, codigo, nombre, prefijo) values (?, ?, ?, ?)', e, codigo, nombre, codigo)),
  ]);

  const roble = await crearTercero(base, e, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Distribuciones El Roble S.A.S.', tipos: ['cliente'], correo: 'compras@elroble.example' });
  const norte = await crearTercero(base, e, { tipo_doc: '31', numero: '901223556', dv: 9, nombre: 'Importadora Suministros del Norte S.A.S.', tipos: ['proveedor'] });
  await crearTercero(base, e, { tipo_doc: '13', numero: '1032556789', dv: null, nombre: 'Laura Restrepo Gómez', tipos: ['cliente'] });

  const anio = new Date().getFullYear();
  const f = (mes: number, dia: number) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const movimientos: [string, string, string, Linea[]][] = [
    ['SI', f(1, 2), 'Saldos iniciales — aporte de los socios', [D('111005', '50000000'), D('110505', '5000000'), C('310505', '55000000')]],
    ['FC', f(1, 15), 'Compra de mercancía SN-10321', [D('143505', '18000000', norte), D('240810', '3420000', norte), C('220505', '20970000', norte), C('236540', '450000', norte)]],
    ['FV', f(2, 10), 'Venta FE-1001 a El Roble', [D('130505', '29750000', roble), C('413595', '25000000', roble), C('240805', '4750000', roble)]],
    ['CG', f(2, 10), 'Costo de la venta FE-1001', [D('613595', '14400000'), C('143505', '14400000')]],
    ['RC', f(3, 5), 'Recaudo FE-1001', [D('111005', '29750000', roble), C('130505', '29750000', roble)]],
    ['CE', f(3, 8), 'Pago a Suministros del Norte', [D('220505', '20970000', norte), C('111005', '20970000', norte)]],
    ['CG', f(3, 31), 'Arriendo de oficina marzo', [D('512010', '3200000', norte), C('111005', '3200000')]],
    ['CG', f(3, 31), 'Energía eléctrica marzo', [D('513530', '412300'), C('111005', '412300')]],
  ];
  const contadores = new Map<string, number>();
  for (const [tipo, fecha, concepto, lineas] of movimientos) {
    const { id } = await crearComprobante(base, e, { tipo, fecha, concepto, lineas });
    const n = (contadores.get(tipo) ?? 0) + 1;
    contadores.set(tipo, n);
    await base.lote([
      s(`update comprobantes set estado = 'contabilizado', numero = ?, sincronizado_en = ? where id = ?`, formatearConsecutivo(tipo, n), new Date().toISOString(), id),
      s(`delete from cola_salida where registro_id = ?`, id),
    ]);
  }
  await base.lote([
    s(`delete from cola_salida where tipo = 'tercero'`),
    s(`insert into estado_sync (empresa_id, ultima_seq, ultima_recepcion) values (?, 0, ?)`, e, new Date().toISOString()),
  ]);
}

/**
 * "Servidor simulado" del modo demostración: valida con el motor y asigna el consecutivo, como el real.
 * Permite ver el flujo completo (pendiente → contabilizado con número oficial) sin cuenta en la nube.
 */
export function transporteDemo(base: BaseLocal): Transporte {
  return {
    async enviar(lote) {
      const ctx = await contextoLocal(base, lote.empresa_id);
      const resultados: ResultadoItem[] = [];
      for (const c of lote.comprobantes) {
        const errores = validarComprobante({
          fecha: c.fecha, concepto: c.concepto,
          lineas: c.lineas.map((l) => ({ cuenta: l.cuenta, terceroId: l.tercero_id, debito: aCentavos(l.debito), credito: aCentavos(l.credito) })),
        }, ctx);
        if (errores.length) {
          resultados.push({ id: c.id, id_servidor: null, clave_idempotencia: c.clave_idempotencia, estado: 'rechazado', numero: null, errores, repetido: false });
          continue;
        }
        const [{ n }] = await base.consultar<{ n: number }>(`select count(*) as n from comprobantes where empresa_id = ? and tipo = ? and numero is not null`, [lote.empresa_id, c.tipo]) as [{ n: number }];
        resultados.push({ id: c.id, id_servidor: c.id, clave_idempotencia: c.clave_idempotencia, estado: 'contabilizado', numero: formatearConsecutivo(c.tipo, Number(n) + 1 + resultados.filter((r) => r.numero?.startsWith(`${c.tipo}-`)).length), errores: [], repetido: false });
      }
      await new Promise((r) => setTimeout(r, 600)); // que se note el estado "sincronizando"
      return {
        version_protocolo: VERSION_PROTOCOLO,
        terceros: lote.terceros.map((t) => ({ id: t.id, id_servidor: t.id, estado: 'registrado' as const, errores: [] })),
        resultados,
      };
    },
    async cambios(q) {
      return { version_protocolo: VERSION_PROTOCOLO, registros: {}, ultima_seq: q.desde, hay_mas: false };
    },
  };
}
