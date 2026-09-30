/**
 * Genera la migración con la plantilla del PUC a partir de @contafi/shared (única fuente de verdad).
 * Uso: node scripts/generar-plantilla-puc.ts   (una prueba verifica que el archivo esté al día)
 */
import { writeFileSync } from 'node:fs';
import { PUC_SEMILLA } from '@contafi/shared';

export const RUTA_MIGRACION = new URL('../migrations/20261001000100_plantilla_puc.sql', import.meta.url);

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function generarPlantillaPuc(): string {
  const filas = PUC_SEMILLA.map((c) => `  (${sql(c.codigo)}, ${sql(c.nombre)}, ${sql(c.naturaleza)}, ${c.exigeTercero})`);
  return `-- ARCHIVO GENERADO por supabase/scripts/generar-plantilla-puc.ts a partir de packages/shared/src/puc.ts.
-- No editar a mano: cambie puc.ts y vuelva a generar.

create table public.plantilla_puc (
  codigo         text primary key check (codigo ~ '^[1-9][0-9]*$'),
  nombre         text not null,
  naturaleza     char(1) not null check (naturaleza in ('D', 'C')),
  exige_tercero  boolean not null default false
);
alter table public.plantilla_puc enable row level security;
create policy plantilla_ver on public.plantilla_puc for select to authenticated using (true);

insert into public.plantilla_puc (codigo, nombre, naturaleza, exige_tercero) values
${filas.join(',\n')};
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(RUTA_MIGRACION, generarPlantillaPuc());
  console.log(`Generado ${RUTA_MIGRACION.pathname} (${PUC_SEMILLA.length} cuentas)`);
}
