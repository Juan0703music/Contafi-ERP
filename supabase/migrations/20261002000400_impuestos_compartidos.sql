-- =============================================================================================
-- Configuración tributaria compartida (sección 5.5, regla de oro): la UVT de cada año (por firma) y los
-- conceptos de retención de cada empresa viven en el servidor y llegan a todos los PC con la descarga
-- de cambios. Antes eran de cada equipo: dos PC podían liquidar la misma compra con tarifas distintas.
--
-- Se editan en línea (como los cierres), con permiso de contabilidad FULL (D-024).
-- =============================================================================================

create table public.uvt_firma (
  firma_id  uuid not null references public.firmas (id) on delete cascade,
  anio      smallint not null check (anio between 2000 and 2100),
  uvt       numeric(12, 2) not null check (uvt > 0),
  primary key (firma_id, anio)
);
alter table public.uvt_firma enable row level security;
create policy uvt_ver on public.uvt_firma for select to authenticated using (public.es_miembro_firma(firma_id));
revoke all on public.uvt_firma from anon;
revoke insert, update, delete on public.uvt_firma from authenticated;

create table public.conceptos_empresa (
  empresa_id       uuid not null references public.empresas (id),
  codigo           text not null check (codigo ~ '^[A-Z0-9-]{2,20}$'),
  tipo             text not null check (tipo in ('RETEFUENTE', 'RETEIVA', 'RETEICA')),
  nombre           text not null check (length(trim(nombre)) between 1 and 200),
  tarifa_ppm       bigint not null check (tarifa_ppm between 0 and 1000000),
  base_minima_uvt  numeric(9, 3) not null default 0 check (base_minima_uvt >= 0),
  cuenta           text not null,
  aplica_en        text not null check (aplica_en in ('compras', 'ventas')),
  activo           boolean not null default true,
  primary key (empresa_id, codigo),
  foreign key (empresa_id, cuenta) references public.cuentas (empresa_id, codigo)
);
alter table public.conceptos_empresa enable row level security;
create policy conceptos_empresa_ver on public.conceptos_empresa for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
revoke all on public.conceptos_empresa from anon;
revoke insert, update, delete on public.conceptos_empresa from authenticated;
create trigger cambio_conceptos after insert or update on public.conceptos_empresa for each row execute function public.trg_registrar_cambio();

-- La UVT es de la firma, pero la descarga de cambios es por empresa: se avisa a cada empresa de la firma.
create function public.guardar_uvt(p_empresa uuid, p_anio int, p_uvt numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_firma uuid;
begin
  if not public.puede(p_empresa, 'contabilidad', 'FULL') then
    raise exception 'SIN_PERMISO: solo el contador o el administrador configuran la UVT' using errcode = '42501';
  end if;
  if p_anio is null or p_anio not between 2000 and 2100 then
    raise exception 'ANIO_INVALIDO: el año % no es válido', p_anio using errcode = '22023';
  end if;
  if p_uvt is null or p_uvt <= 0 or p_uvt <> round(p_uvt, 2) then
    raise exception 'UVT_INVALIDA: la UVT debe ser un valor en pesos mayor que cero' using errcode = '22023';
  end if;
  select firma_id into v_firma from public.empresas where id = p_empresa;
  insert into public.uvt_firma (firma_id, anio, uvt) values (v_firma, p_anio, p_uvt)
  on conflict (firma_id, anio) do update set uvt = excluded.uvt;
  insert into public.cambios (empresa_id, tabla, registro_id, operacion)
  select e.id, 'uvt', p_anio::text, 'UPDATE' from public.empresas e where e.firma_id = v_firma;
  insert into public.auditoria (empresa_id, usuario_id, accion, tabla, registro_id, despues)
  values (p_empresa, auth.uid(), 'GUARDAR_UVT', 'uvt_firma', p_anio::text, jsonb_build_object('firma_id', v_firma, 'uvt', p_uvt));
end $$;

-- Una empresa nueva recibe las UVT que la firma ya tiene configuradas.
create function public.trg_uvt_empresa_nueva()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cambios (empresa_id, tabla, registro_id, operacion)
  select new.id, 'uvt', u.anio::text, 'INSERT' from public.uvt_firma u where u.firma_id = new.firma_id;
  return new;
end $$;
create trigger uvt_empresa_nueva after insert on public.empresas for each row execute function public.trg_uvt_empresa_nueva();

-- Crea o actualiza un concepto con las mismas validaciones que la app.
create function public.guardar_concepto_retencion(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_codigo text := upper(trim(coalesce(p ->> 'codigo', '')));
  v_cuenta public.cuentas;
  v_aplica text := p ->> 'aplica_en';
begin
  if not public.puede(v_empresa, 'contabilidad', 'FULL') then
    raise exception 'SIN_PERMISO: solo el contador o el administrador configuran las retenciones' using errcode = '42501';
  end if;
  if v_codigo !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'DATOS_INVALIDOS: el código debe tener de 2 a 20 letras, números o guiones' using errcode = '22023';
  end if;
  select * into v_cuenta from public.cuentas where empresa_id = v_empresa and codigo = p ->> 'cuenta';
  if not found or not v_cuenta.acepta_movimiento or not v_cuenta.activa then
    raise exception 'DATOS_INVALIDOS: la cuenta % no existe o no es auxiliar', p ->> 'cuenta' using errcode = '22023';
  end if;
  -- Practicadas en compras: pasivo por pagar (grupo 23). Recibidas en ventas: anticipo de impuestos (grupo 13).
  if v_aplica = 'compras' and v_cuenta.codigo not like '23%' then
    raise exception 'DATOS_INVALIDOS: las retenciones que se practican en compras van en una cuenta del grupo 23' using errcode = '22023';
  end if;
  if v_aplica = 'ventas' and v_cuenta.codigo not like '13%' then
    raise exception 'DATOS_INVALIDOS: las retenciones que le practican a la empresa en ventas van en el grupo 13' using errcode = '22023';
  end if;
  insert into public.conceptos_empresa (empresa_id, codigo, tipo, nombre, tarifa_ppm, base_minima_uvt, cuenta, aplica_en, activo)
  values (v_empresa, v_codigo, p ->> 'tipo', trim(p ->> 'nombre'), (p ->> 'tarifa_ppm')::bigint,
          coalesce((p ->> 'base_minima_uvt')::numeric, 0), v_cuenta.codigo, v_aplica, coalesce((p ->> 'activo')::boolean, true))
  on conflict (empresa_id, codigo) do update
    set tipo = excluded.tipo, nombre = excluded.nombre, tarifa_ppm = excluded.tarifa_ppm, base_minima_uvt = excluded.base_minima_uvt,
        cuenta = excluded.cuenta, aplica_en = excluded.aplica_en, activo = excluded.activo;
end $$;

revoke execute on function public.guardar_uvt(uuid, int, numeric), public.guardar_concepto_retencion(jsonb) from public, anon;
grant execute on function public.guardar_uvt(uuid, int, numeric), public.guardar_concepto_retencion(jsonb) to authenticated;
revoke execute on function public.trg_uvt_empresa_nueva() from public, anon, authenticated;
