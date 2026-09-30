-- =============================================================================================
-- CONTAFI — Esquema inicial (secciones 7 y 8 del plan)
--
-- Principios:
--   * El servidor es la fuente oficial. Los clientes NO escriben directo en comprobantes, líneas,
--     consecutivos, períodos ni auditoría: lo hacen por funciones (RPC) que validan y auditan.
--   * Reglas de último recurso en la base: partida doble, inmutabilidad, auditoría solo-agregar.
--   * RLS por empresa en todas las tablas.
--   * Montos en numeric(18,2). El motor trabaja en centavos (bigint) y convierte al enviar.
-- =============================================================================================

create type public.estado_comprobante as enum ('borrador', 'pendiente_sync', 'contabilizado', 'anulado', 'rechazado');
create type public.rol_firma as enum ('propietario', 'administrador', 'miembro');
create type public.rol_empresa as enum ('SuperAdmin', 'Contador', 'AuxContable', 'Tesorero', 'Gerente', 'Auditor');

-- ------------------------------------------------------------------ organización y acceso

create table public.firmas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  plan        text not null default 'prueba',
  estado      text not null default 'activa' check (estado in ('activa', 'suspendida', 'cancelada')),
  creado_en   timestamptz not null default now()
);

create table public.usuarios (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  correo      text not null unique,
  creado_en   timestamptz not null default now()
);

create table public.membresias (
  firma_id    uuid not null references public.firmas (id) on delete cascade,
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  rol         public.rol_firma not null default 'miembro',
  primary key (firma_id, usuario_id)
);

create table public.empresas (
  id                          uuid primary key default gen_random_uuid(),
  firma_id                    uuid not null references public.firmas (id),
  nit                         text not null check (nit ~ '^[0-9]{5,15}$'),
  dv                          smallint check (dv between 0 and 9),
  razon_social                text not null,
  grupo_niif                  smallint not null default 2 check (grupo_niif in (1, 2, 3)),
  regimen                     text,
  municipio                   text,
  responsabilidades_fiscales  text[] not null default '{}',
  activa                      boolean not null default true,
  creado_en                   timestamptz not null default now(),
  unique (firma_id, nit)
);

create table public.empresa_permisos (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  rol         public.rol_empresa not null,
  primary key (empresa_id, usuario_id)
);

create table public.sucursales (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id),
  codigo      text not null,
  nombre      text not null,
  activa      boolean not null default true,
  unique (empresa_id, codigo)
);

create table public.centros_costo (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id),
  codigo      text not null,
  nombre      text not null,
  activo      boolean not null default true,
  unique (empresa_id, codigo),
  unique (empresa_id, id)
);

create table public.dispositivos (
  id           uuid primary key,
  usuario_id   uuid not null references public.usuarios (id) on delete cascade,
  nombre       text not null,
  ultima_sync  timestamptz,
  version_app  text
);

-- ------------------------------------------------------------------ contabilidad

create table public.cuentas (
  empresa_id          uuid not null references public.empresas (id),
  codigo              text not null check (codigo ~ '^[1-9][0-9]*$'),
  nombre              text not null,
  naturaleza          char(1) not null check (naturaleza in ('D', 'C')),
  nivel               smallint not null check (nivel between 1 and 5),
  acepta_movimiento   boolean not null default false,
  exige_tercero       boolean not null default false,
  exige_centro_costo  boolean not null default false,
  activa              boolean not null default true,
  primary key (empresa_id, codigo)
);

create table public.terceros (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id),
  tipo_doc           text not null,            -- 31 NIT, 13 CC, 22 CE, 41 pasaporte...
  numero             text not null,
  dv                 smallint check (dv between 0 and 9),
  nombre             text not null,
  tipos              text[] not null default '{}' check (tipos <@ array['cliente', 'proveedor', 'empleado', 'otro']),
  responsabilidades  text[] not null default '{}',
  direccion          text,
  municipio          text,
  correo             text,
  activo             boolean not null default true,
  unique (empresa_id, tipo_doc, numero),
  unique (empresa_id, id)
);

create table public.periodos (
  empresa_id   uuid not null references public.empresas (id),
  anio         smallint not null check (anio between 2000 and 2100),
  mes          smallint not null check (mes between 1 and 12),
  estado       text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  cerrado_por  uuid references public.usuarios (id),
  cerrado_en   timestamptz,
  primary key (empresa_id, anio, mes)
);

create table public.tipos_comprobante (
  empresa_id  uuid not null references public.empresas (id),
  codigo      text not null check (codigo ~ '^[A-Z]{1,5}$'),
  nombre      text not null,
  prefijo     text not null,
  primary key (empresa_id, codigo)
);

-- Solo el servidor asigna consecutivos (regla 5).
create table public.consecutivos (
  empresa_id  uuid not null,
  tipo        text not null,
  siguiente   bigint not null default 1 check (siguiente >= 1),
  primary key (empresa_id, tipo),
  foreign key (empresa_id, tipo) references public.tipos_comprobante (empresa_id, codigo)
);

create table public.comprobantes (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas (id),
  tipo                text not null,
  numero              text,
  fecha               date not null,
  concepto            text not null check (length(trim(concepto)) > 0),
  estado              public.estado_comprobante not null default 'borrador',
  origen              text not null default 'manual',
  creado_por          uuid references public.usuarios (id),
  creado_en           timestamptz not null default now(),
  dispositivo_id      uuid,
  clave_idempotencia  text,
  reversa_de          uuid references public.comprobantes (id),
  contabilizado_por   uuid references public.usuarios (id),
  contabilizado_en    timestamptz,
  anulado_por         uuid references public.usuarios (id),
  anulado_en          timestamptz,
  motivo_anulacion    text,
  foreign key (empresa_id, tipo) references public.tipos_comprobante (empresa_id, codigo),
  unique (empresa_id, tipo, numero),
  unique (empresa_id, clave_idempotencia),
  check (estado not in ('contabilizado', 'anulado') or numero is not null)
);

create table public.lineas (
  id               bigint generated always as identity primary key,
  comprobante_id   uuid not null references public.comprobantes (id) on delete restrict,
  empresa_id       uuid not null,
  orden            smallint not null,
  cuenta           text not null,
  tercero_id       uuid,
  centro_costo_id  uuid,
  debito           numeric(18, 2) not null default 0,
  credito          numeric(18, 2) not null default 0,
  base_impuesto    numeric(18, 2),
  nota             text,
  -- Regla 2: débito o crédito, nunca ambos, nunca negativos, nunca ambos en cero.
  check (debito >= 0 and credito >= 0 and ((debito = 0) <> (credito = 0))),
  foreign key (empresa_id, cuenta) references public.cuentas (empresa_id, codigo),
  foreign key (empresa_id, tercero_id) references public.terceros (empresa_id, id),
  foreign key (empresa_id, centro_costo_id) references public.centros_costo (empresa_id, id),
  unique (comprobante_id, orden)
);
create index lineas_empresa_cuenta on public.lineas (empresa_id, cuenta);
create index lineas_tercero on public.lineas (empresa_id, tercero_id) where tercero_id is not null;
create index comprobantes_empresa_fecha on public.comprobantes (empresa_id, fecha);

-- ------------------------------------------------------------------ impuestos y parámetros (sección 5.5: nada fijo en el código)

create table public.parametros_anuales (
  anio   smallint primary key,
  uvt    numeric(12, 2) not null check (uvt > 0),
  datos  jsonb not null default '{}'   -- topes, bases y calendario del año
);

create table public.conceptos_retencion (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null,
  tipo              text not null check (tipo in ('RETEFUENTE', 'RETEIVA', 'RETEICA')),
  nombre            text not null,
  tarifa_ppm        bigint not null check (tarifa_ppm >= 0),   -- 2,5 % = 25000
  base_minima_uvt   numeric(10, 3) not null default 0,
  municipio         text,                                       -- solo RETEICA
  vigencia_desde    date not null,
  vigencia_hasta    date,
  unique (codigo, vigencia_desde)
);

create table public.impuestos (
  empresa_id      uuid not null references public.empresas (id),
  codigo          text not null,
  tipo            text not null check (tipo in ('IVA', 'INC', 'RETEFUENTE', 'RETEIVA', 'RETEICA')),
  tarifa_ppm      bigint not null check (tarifa_ppm >= 0),
  cuenta          text not null,
  vigencia_desde  date not null,
  vigencia_hasta  date,
  primary key (empresa_id, codigo, vigencia_desde),
  foreign key (empresa_id, cuenta) references public.cuentas (empresa_id, codigo)
);

-- ------------------------------------------------------------------ documentos electrónicos importados

create table public.documentos_electronicos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id),
  cufe            text not null,
  tipo            text not null check (tipo in ('factura', 'nota_credito', 'nota_debito')),
  sentido         text not null check (sentido in ('compra', 'venta')),
  fuente          text not null default 'importado' check (fuente in ('importado', 'emitido')),
  numero          text not null,
  fecha           date not null,
  tercero_nit     text not null,
  total           numeric(18, 2) not null,
  xml_ruta        text,         -- ruta en Supabase Storage
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'contabilizado', 'descartado')),
  comprobante_id  uuid references public.comprobantes (id),
  creado_en       timestamptz not null default now(),
  unique (empresa_id, cufe)     -- detección de duplicados por CUFE
);

-- ------------------------------------------------------------------ sistema

create table public.auditoria (
  id              bigint generated always as identity primary key,
  empresa_id      uuid references public.empresas (id),
  usuario_id      uuid,
  accion          text not null,
  tabla           text,
  registro_id     text,
  antes           jsonb,
  despues         jsonb,
  dispositivo_id  uuid,
  ip              inet,
  creado_en       timestamptz not null default now()
);
create index auditoria_empresa on public.auditoria (empresa_id, creado_en desc);

-- Secuencia de cambios por empresa, para la sincronización incremental (sección 9.3).
create table public.cambios (
  seq          bigint generated always as identity primary key,
  empresa_id   uuid not null,
  tabla        text not null,
  registro_id  text not null,
  operacion    text not null check (operacion in ('INSERT', 'UPDATE')),
  creado_en    timestamptz not null default now()
);
create index cambios_empresa_seq on public.cambios (empresa_id, seq);

-- =============================================================================================
-- Permisos
-- =============================================================================================

-- Matriz del prototipo (motor/src/permisos.ts). Niveles: NONE 0, READ 1, CREATE 2, APPROVE 3, FULL 4.
create function public.nivel_permiso(p_rol public.rol_empresa, p_modulo text)
returns smallint language sql immutable set search_path = '' as $$
  select coalesce(('{
    "SuperAdmin":  {"contabilidad":4,"ventas":4,"compras":4,"tesoreria":4,"inventario":4,"nomina":4,"cierres":4,"auditoria":4,"configuracion":4},
    "Contador":    {"contabilidad":4,"ventas":1,"compras":1,"tesoreria":3,"inventario":1,"nomina":3,"cierres":4,"auditoria":1,"configuracion":1},
    "AuxContable": {"contabilidad":2,"ventas":2,"compras":2,"tesoreria":1,"inventario":2,"nomina":0,"cierres":0,"auditoria":0,"configuracion":0},
    "Tesorero":    {"contabilidad":1,"ventas":1,"compras":1,"tesoreria":4,"inventario":1,"nomina":1,"cierres":0,"auditoria":0,"configuracion":0},
    "Gerente":     {"contabilidad":1,"ventas":1,"compras":1,"tesoreria":1,"inventario":1,"nomina":1,"cierres":0,"auditoria":1,"configuracion":0},
    "Auditor":     {"contabilidad":1,"ventas":1,"compras":1,"tesoreria":1,"inventario":1,"nomina":1,"cierres":0,"auditoria":4,"configuracion":0}
  }'::jsonb -> p_rol::text ->> p_modulo)::smallint, 0::smallint)
$$;

create function public.es_admin_firma(p_firma uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membresias m
    where m.firma_id = p_firma and m.usuario_id = auth.uid() and m.rol in ('propietario', 'administrador')
  )
$$;

create function public.es_miembro_firma(p_firma uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membresias m where m.firma_id = p_firma and m.usuario_id = auth.uid())
$$;

-- Rol efectivo del usuario actual en una empresa. Los administradores de la firma son SuperAdmin.
create function public.rol_en_empresa(p_empresa uuid)
returns public.rol_empresa language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'SuperAdmin'::public.rol_empresa from public.empresas e
      where e.id = p_empresa and public.es_admin_firma(e.firma_id)),
    (select p.rol from public.empresa_permisos p where p.empresa_id = p_empresa and p.usuario_id = auth.uid())
  )
$$;

create function public.tiene_acceso_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.rol_en_empresa(p_empresa) is not null
$$;

create function public.puede(p_empresa uuid, p_modulo text, p_minimo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.nivel_permiso(public.rol_en_empresa(p_empresa), p_modulo), 0)
         >= case p_minimo when 'READ' then 1 when 'CREATE' then 2 when 'APPROVE' then 3 when 'FULL' then 4 else 99 end
$$;

-- =============================================================================================
-- Reglas de último recurso (sección 8, "Respaldo en Postgres")
-- =============================================================================================

-- Valida la partida doble y las reglas 1–4 al pasar a contabilizado.
create function public.trg_validar_contabilizacion()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_lineas int; v_deb numeric; v_cred numeric; v_malas text;
begin
  if new.estado = 'contabilizado' and (tg_op = 'INSERT' or old.estado is distinct from 'contabilizado') then
    select count(*), coalesce(sum(debito), 0), coalesce(sum(credito), 0)
      into v_lineas, v_deb, v_cred
      from public.lineas where comprobante_id = new.id;
    if v_lineas < 2 then
      raise exception 'MENOS_DE_DOS_LINEAS: el comprobante debe tener al menos dos líneas' using errcode = 'P0001';
    end if;
    if v_deb <> v_cred then
      raise exception 'DESCUADRADO: débitos % <> créditos %', v_deb, v_cred using errcode = 'P0001';
    end if;
    if v_deb <= 0 then
      raise exception 'TOTAL_CERO: el comprobante no tiene movimientos' using errcode = 'P0001';
    end if;
    select string_agg(l.cuenta || ' (' ||
             case when not c.acepta_movimiento then 'no es auxiliar'
                  when not c.activa then 'inactiva'
                  when c.exige_tercero and l.tercero_id is null then 'exige tercero'
                  else 'exige centro de costo' end || ')', ', ')
      into v_malas
      from public.lineas l join public.cuentas c on c.empresa_id = l.empresa_id and c.codigo = l.cuenta
     where l.comprobante_id = new.id
       and (not c.acepta_movimiento or not c.activa
            or (c.exige_tercero and l.tercero_id is null)
            or (c.exige_centro_costo and l.centro_costo_id is null));
    if v_malas is not null then
      raise exception 'CUENTA_INVALIDA: %', v_malas using errcode = 'P0001';
    end if;
    if exists (select 1 from public.periodos p
                where p.empresa_id = new.empresa_id and p.estado = 'cerrado'
                  and p.anio = extract(year from new.fecha) and p.mes = extract(month from new.fecha)) then
      raise exception 'PERIODO_CERRADO: el período %-% está cerrado',
        extract(year from new.fecha), lpad(extract(month from new.fecha)::text, 2, '0') using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger validar_contabilizacion before insert or update on public.comprobantes
  for each row execute function public.trg_validar_contabilizacion();

-- Regla 6: un comprobante contabilizado es inmutable. Solo se permite marcarlo como anulado.
create function public.trg_inmutabilidad_comprobante()
returns trigger language plpgsql set search_path = '' as $$
declare
  campos_anulacion text[] := array['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion'];
begin
  if tg_op = 'DELETE' then
    if old.estado in ('contabilizado', 'anulado') then
      raise exception 'INMUTABLE: el comprobante % está contabilizado y no se puede borrar; anúlelo con un reverso', old.numero
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.estado = 'anulado' then
    raise exception 'INMUTABLE: el comprobante % está anulado', old.numero using errcode = 'P0001';
  end if;
  if old.estado = 'contabilizado' then
    if new.estado <> 'anulado' or (to_jsonb(new) - campos_anulacion) <> (to_jsonb(old) - campos_anulacion) then
      raise exception 'INMUTABLE: el comprobante % está contabilizado; para corregirlo, anúlelo con un reverso', old.numero
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger inmutabilidad_comprobante before update or delete on public.comprobantes
  for each row execute function public.trg_inmutabilidad_comprobante();

create function public.trg_inmutabilidad_lineas()
returns trigger language plpgsql set search_path = '' as $$
declare v_estado public.estado_comprobante;
begin
  select estado into v_estado from public.comprobantes
   where id = case when tg_op = 'DELETE' then old.comprobante_id else new.comprobante_id end;
  if v_estado in ('contabilizado', 'anulado') then
    raise exception 'INMUTABLE: las líneas de un comprobante contabilizado no se pueden modificar' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.comprobante_id <> old.comprobante_id then
    raise exception 'INMUTABLE: una línea no se puede mover de comprobante' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger inmutabilidad_lineas before insert or update or delete on public.lineas
  for each row execute function public.trg_inmutabilidad_lineas();

-- La empresa de la línea es la del comprobante (evita mezclar empresas).
create function public.trg_empresa_linea()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.empresa_id <> (select empresa_id from public.comprobantes where id = new.comprobante_id) then
    raise exception 'La línea y el comprobante pertenecen a empresas distintas' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger empresa_linea before insert or update on public.lineas
  for each row execute function public.trg_empresa_linea();

-- Auditoría: solo se agregan registros.
create function public.trg_auditoria_solo_agregar()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'INMUTABLE: la auditoría no se puede modificar ni borrar' using errcode = 'P0001';
end $$;

create trigger auditoria_solo_agregar before update or delete on public.auditoria
  for each row execute function public.trg_auditoria_solo_agregar();
create trigger auditoria_sin_truncate before truncate on public.auditoria
  for each statement execute function public.trg_auditoria_solo_agregar();

-- Auditoría de cambios en tablas maestras y comprobantes + registro en la secuencia de cambios.
create function public.trg_registrar_cambio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (to_jsonb(new) ->> 'empresa_id')::uuid;
  v_id text := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'codigo',
                        (to_jsonb(new) ->> 'anio') || '-' || (to_jsonb(new) ->> 'mes'));
begin
  insert into public.cambios (empresa_id, tabla, registro_id, operacion) values (v_empresa, tg_table_name, v_id, tg_op);
  insert into public.auditoria (empresa_id, usuario_id, accion, tabla, registro_id, antes, despues)
  values (v_empresa, auth.uid(), tg_op, tg_table_name, v_id,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

create trigger cambio_cuentas after insert or update on public.cuentas for each row execute function public.trg_registrar_cambio();
create trigger cambio_terceros after insert or update on public.terceros for each row execute function public.trg_registrar_cambio();
create trigger cambio_centros after insert or update on public.centros_costo for each row execute function public.trg_registrar_cambio();
create trigger cambio_periodos after insert or update on public.periodos for each row execute function public.trg_registrar_cambio();
create trigger cambio_comprobantes after insert or update on public.comprobantes for each row execute function public.trg_registrar_cambio();
create trigger cambio_tipos after insert or update on public.tipos_comprobante for each row execute function public.trg_registrar_cambio();

-- =============================================================================================
-- Funciones de negocio (RPC). Todo lo que escribe contabilidad pasa por aquí.
-- =============================================================================================

-- Asigna el consecutivo (regla 5: único y sin huecos por tipo y empresa) y contabiliza.
-- Si la contabilización falla, la transacción se revierte y el número no se consume.
create function public.contabilizar_interno(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_c public.comprobantes; v_n bigint; v_prefijo text; v_numero text;
begin
  select * into v_c from public.comprobantes where id = p_id for update;
  if v_c.estado not in ('borrador', 'pendiente_sync') then
    raise exception 'ESTADO_INVALIDO: el comprobante está %', v_c.estado using errcode = 'P0001';
  end if;
  insert into public.consecutivos (empresa_id, tipo) values (v_c.empresa_id, v_c.tipo) on conflict do nothing;
  select siguiente into v_n from public.consecutivos where empresa_id = v_c.empresa_id and tipo = v_c.tipo for update;
  select prefijo into v_prefijo from public.tipos_comprobante where empresa_id = v_c.empresa_id and codigo = v_c.tipo;
  v_numero := v_prefijo || '-' || lpad(v_n::text, 6, '0');
  update public.consecutivos set siguiente = v_n + 1 where empresa_id = v_c.empresa_id and tipo = v_c.tipo;
  update public.comprobantes
     set estado = 'contabilizado', numero = v_numero, contabilizado_por = auth.uid(), contabilizado_en = now()
   where id = p_id;
  return v_numero;
end $$;
revoke all on function public.contabilizar_interno(uuid) from public;

/*
  Registra un comprobante que llega de la app (con o sin conexión previa). Idempotente.
  p = {
    "id": uuid, "empresa_id": uuid, "tipo": "CG", "fecha": "2026-09-30", "concepto": "...",
    "origen": "manual", "clave_idempotencia": "...", "dispositivo_id": uuid, "reversa_de": uuid|null,
    "lineas": [{"cuenta": "111005", "tercero_id": uuid|null, "centro_costo_id": uuid|null,
                "debito": "1000.00", "credito": "0", "base_impuesto": null, "nota": null}, ...]
  }
  Respuesta: {"id", "estado": "contabilizado"|"borrador"|"rechazado", "numero", "motivo", "repetido"}
*/
create function public.registrar_comprobante(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_clave text := nullif(p ->> 'clave_idempotencia', '');
  v_existente public.comprobantes;
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_estado public.estado_comprobante;
  v_numero text;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  if not public.puede(v_empresa, 'contabilidad', 'CREATE') then
    raise exception 'SIN_PERMISO: no tiene permiso para registrar comprobantes en esta empresa' using errcode = '42501';
  end if;
  if v_clave is null then
    raise exception 'FALTA_CLAVE_IDEMPOTENCIA' using errcode = '22023';
  end if;

  -- Idempotencia (sección 9.2): un reenvío devuelve el mismo resultado sin duplicar.
  select * into v_existente from public.comprobantes where empresa_id = v_empresa and clave_idempotencia = v_clave;
  if found then
    return jsonb_build_object('id', v_existente.id, 'estado', v_existente.estado, 'numero', v_existente.numero,
                              'motivo', null, 'repetido', true);
  end if;

  begin
    insert into public.comprobantes (id, empresa_id, tipo, fecha, concepto, estado, origen, creado_por,
                                     dispositivo_id, clave_idempotencia, reversa_de)
    values (v_id, v_empresa, p ->> 'tipo', (p ->> 'fecha')::date, p ->> 'concepto', 'borrador',
            coalesce(p ->> 'origen', 'manual'), auth.uid(), (p ->> 'dispositivo_id')::uuid, v_clave,
            (p ->> 'reversa_de')::uuid);

    insert into public.lineas (comprobante_id, empresa_id, orden, cuenta, tercero_id, centro_costo_id,
                               debito, credito, base_impuesto, nota)
    select v_id, v_empresa, l.ord::smallint, l.v ->> 'cuenta', (l.v ->> 'tercero_id')::uuid,
           (l.v ->> 'centro_costo_id')::uuid, coalesce((l.v ->> 'debito')::numeric, 0),
           coalesce((l.v ->> 'credito')::numeric, 0), (l.v ->> 'base_impuesto')::numeric, l.v ->> 'nota'
      from jsonb_array_elements(p -> 'lineas') with ordinality as l(v, ord);

    -- Con permiso de aprobar se contabiliza; si no, queda en borrador para aprobación.
    if public.puede(v_empresa, 'contabilidad', 'APPROVE') then
      v_numero := public.contabilizar_interno(v_id);
      v_estado := 'contabilizado';
    else
      v_estado := 'borrador';
    end if;
  exception when others then
    -- Todo lo hecho dentro del bloque se revierte (incluido el consecutivo). Se informa el rechazo.
    return jsonb_build_object('id', v_id, 'estado', 'rechazado', 'numero', null, 'motivo', sqlerrm, 'repetido', false);
  end;

  return jsonb_build_object('id', v_id, 'estado', v_estado, 'numero', v_numero, 'motivo', null, 'repetido', false);
end $$;

create function public.aprobar_comprobante(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_empresa uuid;
begin
  select empresa_id into v_empresa from public.comprobantes where id = p_id;
  if v_empresa is null or not public.puede(v_empresa, 'contabilidad', 'APPROVE') then
    raise exception 'SIN_PERMISO: no tiene permiso para aprobar comprobantes' using errcode = '42501';
  end if;
  return public.contabilizar_interno(p_id);
end $$;

-- Regla 6: anula con un comprobante de reverso que indica el motivo.
create function public.anular_comprobante(p_id uuid, p_motivo text, p_fecha date default null, p_clave text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.comprobantes; v_resp jsonb;
begin
  select * into v_c from public.comprobantes where id = p_id for update;
  if not found or not public.puede(v_c.empresa_id, 'contabilidad', 'APPROVE') then
    raise exception 'SIN_PERMISO: no tiene permiso para anular comprobantes' using errcode = '42501';
  end if;
  if v_c.estado <> 'contabilizado' then
    raise exception 'ESTADO_INVALIDO: solo se anulan comprobantes contabilizados (está %)', v_c.estado using errcode = 'P0001';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'FALTA_MOTIVO: la anulación exige un motivo' using errcode = '22023';
  end if;

  v_resp := public.registrar_comprobante(jsonb_build_object(
    'empresa_id', v_c.empresa_id, 'tipo', v_c.tipo, 'fecha', coalesce(p_fecha, v_c.fecha),
    'concepto', 'Anulación de ' || v_c.numero || ' — ' || trim(p_motivo), 'origen', 'reverso',
    'reversa_de', v_c.id, 'clave_idempotencia', coalesce(p_clave, 'anulacion:' || v_c.id::text),
    'lineas', (select jsonb_agg(jsonb_build_object(
                 'cuenta', l.cuenta, 'tercero_id', l.tercero_id, 'centro_costo_id', l.centro_costo_id,
                 'debito', l.credito, 'credito', l.debito, 'base_impuesto', l.base_impuesto, 'nota', l.nota)
                 order by l.orden)
               from public.lineas l where l.comprobante_id = v_c.id)));
  if v_resp ->> 'estado' <> 'contabilizado' then
    raise exception 'REVERSO_RECHAZADO: %', v_resp ->> 'motivo' using errcode = 'P0001';
  end if;

  update public.comprobantes
     set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = trim(p_motivo)
   where id = p_id;
  return v_resp;
end $$;

-- Regla 4: cierre y reapertura de períodos (exige permiso y queda en auditoría por el trigger).
create function public.cambiar_estado_periodo(p_empresa uuid, p_anio int, p_mes int, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede(p_empresa, 'cierres', 'FULL') then
    raise exception 'SIN_PERMISO: no tiene permiso para gestionar cierres de período' using errcode = '42501';
  end if;
  if p_estado not in ('abierto', 'cerrado') then
    raise exception 'Estado de período inválido: %', p_estado using errcode = '22023';
  end if;
  insert into public.periodos (empresa_id, anio, mes, estado, cerrado_por, cerrado_en)
  values (p_empresa, p_anio, p_mes, p_estado,
          case when p_estado = 'cerrado' then auth.uid() end, case when p_estado = 'cerrado' then now() end)
  on conflict (empresa_id, anio, mes) do update
    set estado = excluded.estado, cerrado_por = excluded.cerrado_por, cerrado_en = excluded.cerrado_en;
end $$;

-- =============================================================================================
-- RLS: el usuario A nunca ve la empresa B
-- =============================================================================================

alter table public.firmas enable row level security;
alter table public.usuarios enable row level security;
alter table public.membresias enable row level security;
alter table public.empresas enable row level security;
alter table public.empresa_permisos enable row level security;
alter table public.sucursales enable row level security;
alter table public.centros_costo enable row level security;
alter table public.dispositivos enable row level security;
alter table public.cuentas enable row level security;
alter table public.terceros enable row level security;
alter table public.periodos enable row level security;
alter table public.tipos_comprobante enable row level security;
alter table public.consecutivos enable row level security;
alter table public.comprobantes enable row level security;
alter table public.lineas enable row level security;
alter table public.parametros_anuales enable row level security;
alter table public.conceptos_retencion enable row level security;
alter table public.impuestos enable row level security;
alter table public.documentos_electronicos enable row level security;
alter table public.auditoria enable row level security;
alter table public.cambios enable row level security;

create policy firmas_ver on public.firmas for select to authenticated using (public.es_miembro_firma(id));

create policy usuarios_ver on public.usuarios for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.membresias a join public.membresias b on a.firma_id = b.firma_id
     where a.usuario_id = auth.uid() and b.usuario_id = usuarios.id));
create policy usuarios_editar on public.usuarios for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy membresias_ver on public.membresias for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin_firma(firma_id));
create policy membresias_admin on public.membresias for all to authenticated
  using (public.es_admin_firma(firma_id)) with check (public.es_admin_firma(firma_id));

create policy empresas_ver on public.empresas for select to authenticated using (public.tiene_acceso_empresa(id));
create policy empresas_crear on public.empresas for insert to authenticated with check (public.es_admin_firma(firma_id));
create policy empresas_editar on public.empresas for update to authenticated
  using (public.es_admin_firma(firma_id)) with check (public.es_admin_firma(firma_id));

create policy permisos_ver on public.empresa_permisos for select to authenticated
  using (usuario_id = auth.uid() or public.puede(empresa_id, 'configuracion', 'FULL'));
create policy permisos_admin on public.empresa_permisos for all to authenticated
  using (public.puede(empresa_id, 'configuracion', 'FULL')) with check (public.puede(empresa_id, 'configuracion', 'FULL'));

create policy dispositivos_propios on public.dispositivos for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Datos maestros por empresa: leer con acceso; crear/editar según el módulo. No se borran: se inactivan.
create policy sucursales_ver on public.sucursales for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy sucursales_crear on public.sucursales for insert to authenticated with check (public.puede(empresa_id, 'configuracion', 'CREATE'));
create policy sucursales_editar on public.sucursales for update to authenticated using (public.puede(empresa_id, 'configuracion', 'CREATE'));

create policy centros_ver on public.centros_costo for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy centros_crear on public.centros_costo for insert to authenticated with check (public.puede(empresa_id, 'configuracion', 'CREATE'));
create policy centros_editar on public.centros_costo for update to authenticated using (public.puede(empresa_id, 'configuracion', 'CREATE'));

create policy cuentas_ver on public.cuentas for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy cuentas_crear on public.cuentas for insert to authenticated with check (public.puede(empresa_id, 'configuracion', 'CREATE'));
create policy cuentas_editar on public.cuentas for update to authenticated using (public.puede(empresa_id, 'configuracion', 'CREATE'));

create policy terceros_ver on public.terceros for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy terceros_crear on public.terceros for insert to authenticated with check (public.puede(empresa_id, 'contabilidad', 'CREATE'));
create policy terceros_editar on public.terceros for update to authenticated using (public.puede(empresa_id, 'contabilidad', 'CREATE'));

create policy tipos_ver on public.tipos_comprobante for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy tipos_crear on public.tipos_comprobante for insert to authenticated with check (public.puede(empresa_id, 'configuracion', 'FULL'));

create policy impuestos_ver on public.impuestos for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy impuestos_admin on public.impuestos for all to authenticated
  using (public.puede(empresa_id, 'configuracion', 'CREATE')) with check (public.puede(empresa_id, 'configuracion', 'CREATE'));

-- Contabilidad: solo lectura directa. Las escrituras pasan por las funciones de arriba.
create policy periodos_ver on public.periodos for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy consecutivos_ver on public.consecutivos for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy comprobantes_ver on public.comprobantes for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy lineas_ver on public.lineas for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy cambios_ver on public.cambios for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy auditoria_ver on public.auditoria for select to authenticated using (public.puede(empresa_id, 'auditoria', 'READ'));

create policy documentos_ver on public.documentos_electronicos for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy documentos_crear on public.documentos_electronicos for insert to authenticated with check (public.puede(empresa_id, 'contabilidad', 'CREATE'));
create policy documentos_editar on public.documentos_electronicos for update to authenticated using (public.puede(empresa_id, 'contabilidad', 'CREATE'));

-- Parámetros globales: lectura para todos los usuarios autenticados; se actualizan desde el servidor.
create policy parametros_ver on public.parametros_anuales for select to authenticated using (true);
create policy conceptos_ver on public.conceptos_retencion for select to authenticated using (true);

-- Defensa en profundidad: aunque RLS ya lo impide, se quitan privilegios de escritura directa.
revoke insert, update, delete, truncate on public.comprobantes, public.lineas, public.consecutivos,
  public.periodos, public.auditoria, public.cambios from anon, authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.registrar_comprobante(jsonb), public.aprobar_comprobante(uuid),
  public.anular_comprobante(uuid, text, date, text), public.cambiar_estado_periodo(uuid, int, int, text)
  to authenticated;
