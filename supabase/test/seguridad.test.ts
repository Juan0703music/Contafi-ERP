import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { crearBaseDePrueba } from './entorno.ts';

/**
 * Auditoría automática de seguridad (checklist de lanzamiento): revisa la base COMPLETA, no casos sueltos.
 * Si una migración nueva crea una tabla sin RLS, da permisos de más o una función insegura, esta prueba falla.
 */
let db: PGlite;
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => { db = await crearBaseDePrueba(); });

describe('auditoría de seguridad de la base', () => {
  it('toda tabla del esquema public tiene RLS activo', async () => {
    expect(await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).toEqual([]);
  });

  it('sin sesión (anon) solo se leen los precios; nadie tiene TRUNCATE', async () => {
    expect(await q(`select table_name, privilege_type from information_schema.role_table_grants
                     where grantee = 'anon' and table_schema = 'public' order by 1, 2`)).toEqual([{ table_name: 'planes', privilege_type: 'SELECT' }]);
    expect(await q(`select table_name, grantee from information_schema.role_table_grants
                     where grantee in ('anon', 'authenticated') and table_schema = 'public' and privilege_type = 'TRUNCATE'`)).toEqual([]);
  });

  it('las tablas que un usuario puede escribir directamente son solo las previstas (y las protege RLS)', async () => {
    const filas = await q<{ table_name: string; p: string }>(`select table_name, string_agg(privilege_type, ',' order by privilege_type) as p
      from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE') group by 1 order by 1`);
    // Todo lo demás (comprobantes, cuentas, membresías, planes, firmas, configuración tributaria…) solo por funciones del servidor.
    expect(filas.map((f) => f.table_name)).toEqual([
      'centros_costo', 'conceptos_retencion', 'dispositivos', 'documentos_electronicos', 'empresas', 'impuestos',
      'parametros_anuales', 'productos', 'sucursales', 'terceros', 'tipos_comprobante', 'usuarios',
    ]);
    expect(filas.find((f) => f.table_name === 'empresas')!.p).toBe('DELETE,UPDATE'); // crear solo con crear_empresa
  });

  it('toda función SECURITY DEFINER fija su search_path; ninguna función se ejecuta sin sesión', async () => {
    expect(await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prosecdef
                       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).toEqual([]);
    expect(await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).toEqual([]);
  });
});
