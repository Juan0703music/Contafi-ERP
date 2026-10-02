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
  // 3 · Parámetros tributarios configurables (regla de oro: nada fijo en el código)
  [
    `create table parametros_anuales (anio integer primary key, uvt integer not null check (uvt > 0)) strict`,
    `create table conceptos_retencion (
       empresa_id text not null, codigo text not null,
       tipo text not null check (tipo in ('RETEFUENTE', 'RETEIVA', 'RETEICA')),
       nombre text not null, tarifa_ppm integer not null check (tarifa_ppm between 0 and 1000000),
       base_minima_uvt text not null default '0', cuenta text not null,
       aplica_en text not null check (aplica_en in ('compras', 'ventas')), activo integer not null default 1,
       primary key (empresa_id, codigo)
     ) strict`,
    // Retenciones que se practican a cada proveedor: se aprenden al importar, como las cuentas.
    `create table retenciones_proveedor (
       empresa_id text not null, nit text not null, codigo text not null, primary key (empresa_id, nit, codigo)
     ) strict`,
  ],
  // 4 · Conciliación bancaria (extractos importados y parejas extracto ↔ libros)
  [
    `create table extractos (
       id text primary key, empresa_id text not null, cuenta text not null, archivo text not null,
       desde text not null, hasta text not null, saldo_final integer not null, importado_en text not null
     ) strict`,
    `create table lineas_extracto (
       id text primary key, extracto_id text not null references extractos (id) on delete cascade,
       fecha text not null, descripcion text not null, referencia text, valor integer not null
     ) strict`,
    // movimiento_libro = "<comprobante_id>:<orden de la línea>"
    `create table conciliaciones (
       linea_extracto_id text primary key references lineas_extracto (id) on delete cascade,
       movimiento_libro text not null unique, conciliado_en text not null
     ) strict`,
  ],
  // 5 · Inventario básico: productos, y producto + cantidad (milésimas) en las líneas contables
  [
    `create table productos (
       id text primary key, empresa_id text not null, codigo text not null, nombre text not null,
       tipo text not null check (tipo in ('producto', 'servicio')), unidad text not null,
       cuenta_inventario text not null, iva_tipo text not null, iva_tarifa_ppm integer,
       precio_venta integer, activo integer not null default 1, errores_sync text
     ) strict`,
    `create unique index productos_codigo on productos (empresa_id, codigo)`,
    `alter table lineas add column producto_id text`,
    `alter table lineas add column cantidad integer`,
    `create index lineas_producto on lineas (producto_id)`,
    // La cola de salida ahora también lleva productos (SQLite no permite cambiar un CHECK: se recrea).
    `create table cola_salida_nueva (
       seq integer primary key autoincrement, empresa_id text not null,
       tipo text not null check (tipo in ('comprobante', 'tercero', 'producto')), registro_id text not null,
       intentos integer not null default 0, ultimo_error text, creado_en text not null,
       unique (tipo, registro_id)
     ) strict`,
    `insert into cola_salida_nueva select * from cola_salida`,
    `drop table cola_salida`,
    `alter table cola_salida_nueva rename to cola_salida`,
  ],
  // 6 · PUC personalizable: las cuentas creadas o editadas en el PC también viajan en la cola. Como el
  // registro de una cuenta es su código (no un id global), la cola se identifica por empresa.
  [
    `alter table cuentas add column errores_sync text`,
    // 0 = creada en este PC y el servidor aún no la acepta (si la rechaza, se puede descartar).
    `alter table cuentas add column en_servidor integer not null default 1`,
    `create table cola_salida_nueva (
       seq integer primary key autoincrement, empresa_id text not null,
       tipo text not null check (tipo in ('comprobante', 'tercero', 'producto', 'cuenta')), registro_id text not null,
       intentos integer not null default 0, ultimo_error text, creado_en text not null,
       unique (empresa_id, tipo, registro_id)
     ) strict`,
    `insert into cola_salida_nueva select * from cola_salida`,
    `drop table cola_salida`,
    `alter table cola_salida_nueva rename to cola_salida`,
  ],
  // 7 · Reglas por proveedor compartidas entre PC (como en el servidor): cuenta y retenciones aprendidas en
  // una sola tabla. null = no se ha aprendido (no borra lo que aprenda otro PC). Viajan en la cola ('regla').
  [
    `create table reglas_proveedor_nueva (
       empresa_id text not null, nit text not null, cuenta text, retenciones text, actualizado_en text not null,
       primary key (empresa_id, nit)
     ) strict`,
    `insert into reglas_proveedor_nueva (empresa_id, nit, cuenta, actualizado_en)
       select empresa_id, nit, cuenta, actualizado_en from reglas_proveedor`,
    `insert into reglas_proveedor_nueva (empresa_id, nit, retenciones, actualizado_en)
       select empresa_id, nit, json_group_array(codigo), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         from (select empresa_id, nit, codigo from retenciones_proveedor order by empresa_id, nit, codigo)
        where true group by empresa_id, nit
       on conflict (empresa_id, nit) do update set retenciones = excluded.retenciones`,
    `drop table reglas_proveedor`,
    `drop table retenciones_proveedor`,
    `alter table reglas_proveedor_nueva rename to reglas_proveedor`,
    `create table cola_salida_nueva (
       seq integer primary key autoincrement, empresa_id text not null,
       tipo text not null check (tipo in ('comprobante', 'tercero', 'producto', 'cuenta', 'regla')), registro_id text not null,
       intentos integer not null default 0, ultimo_error text, creado_en text not null,
       unique (empresa_id, tipo, registro_id)
     ) strict`,
    `insert into cola_salida_nueva select * from cola_salida`,
    `drop table cola_salida`,
    `alter table cola_salida_nueva rename to cola_salida`,
  ],
  // 8 · Calendario tributario (por año; lo carga el contador y llega del servidor) y obligaciones de cada empresa
  [
    `create table calendario (anio integer primary key, filas text not null) strict`,
    `create table obligaciones (empresa_id text primary key, codigos text not null) strict`,
  ],
  // 9 · Métricas de sincronización por empresa (Fase 6: "medir la sincronización"; diagnóstico para soporte)
  [
    `create table metricas_sync (
       empresa_id text primary key, sincronizaciones integer not null default 0, operaciones integer not null default 0,
       rechazos integer not null default 0, fallos integer not null default 0, desde text not null, ultimo_fallo text
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
