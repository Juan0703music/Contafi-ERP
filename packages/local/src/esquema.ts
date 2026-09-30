import type { BaseLocal, Sentencia } from './base.ts';

/**
 * Migraciones de la base local. Se aplican al abrir la app (sección 14), en orden y cada una en su
 * propio lote junto con PRAGMA user_version, así que un apagón a mitad no deja la base a medias.
 * NUNCA modificar una migración publicada: agregar una nueva al final.
 */
export const MIGRACIONES: readonly string[][] = [
  [
    `create table empresas (
       id text primary key, firma_id text not null, nit text not null, dv integer,
       razon_social text not null, actualizado_en text not null
     ) strict`,
    `create table cuentas (
       empresa_id text not null, codigo text not null, nombre text not null,
       naturaleza text not null check (naturaleza in ('D', 'C')), nivel integer not null,
       acepta_movimiento integer not null, exige_tercero integer not null, exige_centro_costo integer not null,
       activa integer not null, primary key (empresa_id, codigo)
     ) strict`,
    `create table terceros (
       id text primary key, empresa_id text not null, tipo_doc text not null, numero text not null, dv integer,
       nombre text not null, tipos text not null default '[]', responsabilidades text not null default '[]',
       direccion text, municipio text, correo text, activo integer not null default 1,
       errores_sync text
     ) strict`,
    `create unique index terceros_documento on terceros (empresa_id, tipo_doc, numero)`,
    `create table centros_costo (
       id text primary key, empresa_id text not null, codigo text not null, nombre text not null, activo integer not null
     ) strict`,
    `create table periodos (
       empresa_id text not null, anio integer not null, mes integer not null,
       estado text not null check (estado in ('abierto', 'cerrado')), primary key (empresa_id, anio, mes)
     ) strict`,
    `create table tipos_comprobante (
       empresa_id text not null, codigo text not null, nombre text not null, prefijo text not null,
       primary key (empresa_id, codigo)
     ) strict`,
    `create table comprobantes (
       id text primary key, empresa_id text not null, tipo text not null,
       numero text, numero_local text,
       fecha text not null, concepto text not null,
       estado text not null check (estado in ('pendiente_sync', 'por_aprobar', 'contabilizado', 'anulado', 'rechazado')),
       origen text not null, clave_idempotencia text, reversa_de text,
       errores text, creado_en text not null, sincronizado_en text
     ) strict`,
    `create index comprobantes_empresa_fecha on comprobantes (empresa_id, fecha)`,
    `create table lineas (
       comprobante_id text not null references comprobantes (id) on delete cascade,
       orden integer not null, cuenta text not null, tercero_id text, centro_costo_id text,
       debito integer not null check (debito >= 0), credito integer not null check (credito >= 0),
       base_impuesto integer, nota text,
       primary key (comprobante_id, orden)
     ) strict`,
    `create index lineas_cuenta on lineas (cuenta)`,
    `create index lineas_tercero on lineas (tercero_id)`,
    // Cola de salida (sección 9.1): lo que falta subir, en el orden en que se creó.
    `create table cola_salida (
       seq integer primary key autoincrement, empresa_id text not null,
       tipo text not null check (tipo in ('comprobante', 'tercero')), registro_id text not null,
       intentos integer not null default 0, ultimo_error text, creado_en text not null,
       unique (tipo, registro_id)
     ) strict`,
    `create table estado_sync (
       empresa_id text primary key, ultima_seq integer not null default 0,
       ultima_recepcion text, ultimo_envio text
     ) strict`,
    // Autoguardado de formularios cada pocos segundos (sección 9.5).
    `create table borradores (
       clave text primary key, empresa_id text, contenido text not null, actualizado_en text not null
     ) strict`,
  ],
  // 2 · Importación de facturas electrónicas de la DIAN (Fase 4)
  [
    `create table documentos_dian (
       empresa_id text not null, cufe text not null, tipo text not null, sentido text not null check (sentido in ('compra', 'venta')),
       numero text not null, tercero_nit text not null, tercero_nombre text not null, fecha text not null,
       total integer not null, comprobante_id text, importado_en text not null,
       primary key (empresa_id, cufe)
     ) strict`,
    // Cuenta que el contador eligió para cada proveedor: se "aprende" al importar (sección 11.1).
    `create table reglas_proveedor (
       empresa_id text not null, nit text not null, cuenta text not null, actualizado_en text not null,
       primary key (empresa_id, nit)
     ) strict`,
  ],
];

export const VERSION_ESQUEMA = MIGRACIONES.length;

export async function versionEsquema(base: BaseLocal): Promise<number> {
  const [f] = await base.consultar<{ user_version: number }>('pragma user_version');
  return Number(f?.user_version ?? 0);
}

/** Aplica las migraciones pendientes. Devuelve cuántas aplicó. */
export async function migrar(base: BaseLocal): Promise<number> {
  const actual = await versionEsquema(base);
  if (actual > VERSION_ESQUEMA) {
    throw new Error(`La base local es de una versión más nueva de Contafi (${actual} > ${VERSION_ESQUEMA}). Actualice la aplicación.`);
  }
  for (let v = actual; v < VERSION_ESQUEMA; v++) {
    const sentencias: Sentencia[] = MIGRACIONES[v]!.map((sql) => ({ sql }));
    sentencias.push({ sql: `pragma user_version = ${v + 1}` });
    await base.lote(sentencias);
  }
  return VERSION_ESQUEMA - actual;
}
