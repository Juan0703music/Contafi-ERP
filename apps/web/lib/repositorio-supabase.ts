import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cuenta } from '@contafi/motor';
import { ErrorRegistro, type Cambio, type RepositorioSync, type ResultadoRegistro, type TablaSync } from '@contafi/sync';
import { traducirError } from './supabase.ts';

// PostgREST devuelve como máximo 1.000 filas por consulta y las URL largas fallan: se pagina y se parte.
const PAGINA = 1000;
const TROZO_IDS = 100;

function trozos<T>(xs: T[], n: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
}

/** Montos como texto: numeric(18,2) no cabe con exactitud en un number de JavaScript. */
/** Mismos códigos que en test/repositorio-pglite.ts de @contafi/sync. */
const CODIGOS_DE_DATOS = new Set(['P0001', '22023', '22P02', '23505', '23503', '23514', '23502']);

const COLUMNAS_LINEAS = 'orden,cuenta,tercero_id,centro_costo_id,debito::text,credito::text,base_impuesto::text,nota,producto_id,cantidad::text';

/**
 * Implementación de RepositorioSync sobre Supabase con la sesión del usuario.
 * Hace lo mismo que test/repositorio-pglite.ts de @contafi/sync, que es la versión probada contra Postgres.
 */
export function repositorioSupabase(sb: SupabaseClient): RepositorioSync {
  const puede = async (empresa: string, minimo: string) => {
    const { data, error } = await sb.rpc('puede', { p_empresa: empresa, p_modulo: 'contabilidad', p_minimo: minimo });
    if (error) throw traducirError(error);
    return data === true;
  };

  return {
    puedeRegistrar: (e) => puede(e, 'CREATE'),
    puedeLeer: (e) => puede(e, 'READ'),

    async contexto(empresa) {
      const cuentas: Cuenta[] = [];
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await sb.from('cuentas')
          .select('codigo,nombre,naturaleza,acepta_movimiento,exige_tercero,exige_centro_costo,activa')
          .eq('empresa_id', empresa).order('codigo').range(desde, desde + PAGINA - 1);
        if (error) throw traducirError(error);
        for (const c of data) {
          cuentas.push({
            codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza, aceptaMovimiento: c.acepta_movimiento,
            exigeTercero: c.exige_tercero, exigeCentroCosto: c.exige_centro_costo, activa: c.activa,
          });
        }
        if (data.length < PAGINA) break;
      }
      const { data: periodos, error } = await sb.from('periodos').select('anio,mes').eq('empresa_id', empresa).eq('estado', 'cerrado');
      if (error) throw traducirError(error);
      return { cuentas, periodosCerrados: periodos.map((p) => `${p.anio}-${String(p.mes).padStart(2, '0')}`) };
    },

    async buscarPorClave(empresa, clave) {
      const { data, error } = await sb.from('comprobantes').select('id,estado,numero')
        .eq('empresa_id', empresa).eq('clave_idempotencia', clave).maybeSingle();
      if (error) throw traducirError(error);
      return data ? { id: data.id, estado: data.estado, numero: data.numero, motivo: null, repetido: true } : null;
    },

    async registrar(p) {
      const { data, error } = await sb.rpc('registrar_comprobante', { p });
      if (error) throw traducirError(error);
      return data as ResultadoRegistro;
    },

    async registrarTercero(p) {
      const { data, error } = await sb.rpc('registrar_tercero', { p });
      if (error) {
        if (error.code && CODIGOS_DE_DATOS.has(error.code)) {
          throw new ErrorRegistro(/^([A-Z_]{4,}):/.exec(error.message)?.[1] ?? (error.code === '23505' ? 'DUPLICADO' : 'DATOS_INVALIDOS'), error.message);
        }
        throw traducirError(error);
      }
      return data as string;
    },

    async registrarProducto(p) {
      const { data, error } = await sb.rpc('registrar_producto', { p });
      if (error) {
        if (error.code && CODIGOS_DE_DATOS.has(error.code)) {
          throw new ErrorRegistro(/^([A-Z_]{4,}):/.exec(error.message)?.[1] ?? (error.code === '23505' ? 'DUPLICADO' : 'DATOS_INVALIDOS'), error.message);
        }
        throw traducirError(error);
      }
      return data as string;
    },

    async marcarSincronizacion(d) {
      const { error } = await sb.rpc('marcar_sincronizacion', { p_id: d.id, p_nombre: d.nombre, p_version: d.version_app });
      if (error) throw traducirError(error);
    },

    async cambios(empresa, desde, limite) {
      const { data, error } = await sb.from('cambios').select('seq,tabla,registro_id,operacion')
        .eq('empresa_id', empresa).gt('seq', desde).order('seq').limit(limite);
      if (error) throw traducirError(error);
      return data.map((c): Cambio => ({ ...c, seq: Number(c.seq) }));
    },

    async registros(empresa, tabla: TablaSync, ids) {
      const filas: Record<string, unknown>[] = [];
      for (const grupo of trozos(ids, TROZO_IDS)) {
        let consulta;
        switch (tabla) {
          case 'cuentas':
          case 'tipos_comprobante':
            consulta = sb.from(tabla).select('*').eq('empresa_id', empresa).in('codigo', grupo);
            break;
          case 'periodos': {
            const filtro = grupo.map((id) => {
              const [anio, mes] = id.split('-').map(Number);
              return `and(anio.eq.${anio},mes.eq.${mes})`;
            }).join(',');
            consulta = sb.from('periodos').select('*').eq('empresa_id', empresa).or(filtro);
            break;
          }
          case 'productos':
            consulta = sb.from('productos').select('id,empresa_id,codigo,nombre,tipo,unidad,cuenta_inventario,iva_tipo,iva_tarifa_ppm,precio_venta::text,activo')
              .eq('empresa_id', empresa).in('id', grupo);
            break;
          case 'comprobantes':
            consulta = sb.from('comprobantes').select(`*,lineas(${COLUMNAS_LINEAS})`)
              .eq('empresa_id', empresa).in('id', grupo).order('orden', { referencedTable: 'lineas' });
            break;
          default:
            consulta = sb.from(tabla).select('*').eq('empresa_id', empresa).in('id', grupo);
        }
        const { data, error } = await consulta;
        if (error) throw traducirError(error);
        filas.push(...(data as Record<string, unknown>[]));
      }
      return filas;
    },
  };
}
