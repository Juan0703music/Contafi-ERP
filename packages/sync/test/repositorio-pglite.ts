/** Implementación del repositorio sobre PGlite, con la sesión del usuario (RLS aplica). Solo para pruebas. */
import type { PGlite } from '@electric-sql/pglite';
import type { Cuenta } from '@contafi/motor';
import { como, type Sesion } from '@contafi/supabase/test/entorno';
import { ErrorRegistro, type Cambio, type RepositorioSync, type ResultadoRegistro, type TablaSync } from '../src/index.ts';

/** Códigos de Postgres que son errores de datos de un registro (no de sesión ni del sistema). */
export const CODIGOS_DE_DATOS = new Set(['P0001', '22023', '22P02', '23505', '23503', '23514', '23502']);

export function comoErrorRegistro(e: unknown): never {
  const codigo = (e as { code?: string }).code;
  const mensaje = (e as Error).message ?? String(e);
  if (codigo && CODIGOS_DE_DATOS.has(codigo)) {
    throw new ErrorRegistro(/^([A-Z_]{4,}):/.exec(mensaje)?.[1] ?? (codigo === '23505' ? 'DUPLICADO' : 'DATOS_INVALIDOS'), mensaje);
  }
  throw e;
}

export const SQL_REGISTROS: Record<TablaSync, string> = {
  cuentas: 'select * from public.cuentas where empresa_id = $1 and codigo = any($2::text[])',
  tipos_comprobante: 'select * from public.tipos_comprobante where empresa_id = $1 and codigo = any($2::text[])',
  periodos: `select * from public.periodos where empresa_id = $1 and (anio || '-' || mes) = any($2::text[])`,
  terceros: 'select * from public.terceros where empresa_id = $1 and id = any($2::uuid[])',
  productos: 'select id, empresa_id, codigo, nombre, tipo, unidad, cuenta_inventario, iva_tipo, iva_tarifa_ppm::int as iva_tarifa_ppm, precio_venta::text as precio_venta, activo from public.productos where empresa_id = $1 and id = any($2::uuid[])',
  centros_costo: 'select * from public.centros_costo where empresa_id = $1 and id = any($2::uuid[])',
  // Columnas explícitas y fechas como texto, igual que las entrega PostgREST.
  comprobantes: `
    select c.id, c.empresa_id, c.tipo, c.numero, c.fecha::text as fecha, c.concepto, c.estado, c.origen,
           c.clave_idempotencia, c.reversa_de, c.creado_en, c.contabilizado_en, c.anulado_en, c.motivo_anulacion, coalesce((
      select json_agg(json_build_object(
        'orden', l.orden, 'cuenta', l.cuenta, 'tercero_id', l.tercero_id, 'centro_costo_id', l.centro_costo_id,
        'debito', l.debito::text, 'credito', l.credito::text, 'base_impuesto', l.base_impuesto::text, 'nota', l.nota,
        'producto_id', l.producto_id, 'cantidad', l.cantidad::text
      ) order by l.orden) from public.lineas l where l.comprobante_id = c.id), '[]') as lineas
      from public.comprobantes c where c.empresa_id = $1 and c.id = any($2::uuid[])`,
};

export function repositorioPglite(db: PGlite, sesion: Sesion): RepositorioSync {
  const q = <T>(sql: string, p: unknown[] = []) => como<T>(db, sesion, sql, p);
  const puede = async (empresa: string, minimo: string) =>
    (await q<{ p: boolean }>(`select public.puede($1, 'contabilidad', $2) as p`, [empresa, minimo]))[0]!.p;
  return {
    puedeRegistrar: (e) => puede(e, 'CREATE'),
    puedeLeer: (e) => puede(e, 'READ'),
    async contexto(empresa) {
      const cuentas = await q<{ codigo: string; nombre: string; naturaleza: 'D' | 'C'; acepta_movimiento: boolean; exige_tercero: boolean; exige_centro_costo: boolean; activa: boolean }>(
        'select codigo, nombre, naturaleza, acepta_movimiento, exige_tercero, exige_centro_costo, activa from public.cuentas where empresa_id = $1', [empresa]);
      const periodos = await q<{ p: string }>(
        `select anio || '-' || lpad(mes::text, 2, '0') as p from public.periodos where empresa_id = $1 and estado = 'cerrado'`, [empresa]);
      return {
        cuentas: cuentas.map((c): Cuenta => ({
          codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza, aceptaMovimiento: c.acepta_movimiento,
          exigeTercero: c.exige_tercero, exigeCentroCosto: c.exige_centro_costo, activa: c.activa,
        })),
        periodosCerrados: periodos.map((p) => p.p),
      };
    },
    async buscarPorClave(empresa, clave) {
      const [c] = await q<{ id: string; estado: string; numero: string | null }>(
        'select id, estado, numero from public.comprobantes where empresa_id = $1 and clave_idempotencia = $2', [empresa, clave]);
      return c ? { id: c.id, estado: c.estado as ResultadoRegistro['estado'], numero: c.numero, motivo: null, repetido: true } : null;
    },
    async registrar(p) {
      return (await q<{ r: ResultadoRegistro }>('select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify(p)]))[0]!.r;
    },
    async registrarTercero(p) {
      try {
        return (await q<{ id: string }>('select public.registrar_tercero($1::jsonb) as id', [JSON.stringify(p)]))[0]!.id;
      } catch (e) {
        return comoErrorRegistro(e);
      }
    },
    async registrarProducto(p) {
      try {
        return (await q<{ id: string }>('select public.registrar_producto($1::jsonb) as id', [JSON.stringify(p)]))[0]!.id;
      } catch (e) {
        return comoErrorRegistro(e);
      }
    },
    async marcarSincronizacion(d) {
      await q('select public.marcar_sincronizacion($1, $2, $3)', [d.id, d.nombre, d.version_app]);
    },
    async cambios(empresa, desde, limite) {
      return (await q<Cambio>('select seq::int as seq, tabla, registro_id, operacion from public.cambios where empresa_id = $1 and seq > $2 order by seq limit $3',
        [empresa, desde, limite]));
    },
    registros: (empresa, tabla, ids) => q<Record<string, unknown>>(SQL_REGISTROS[tabla], [empresa, ids]),
  };
}
