-- =============================================================================================
-- Calendario tributario (panel del contador: vencimientos). Las fechas las carga el contador cada año
-- desde el decreto del calendario (regla de oro: nada fijo en el código). Se guardan por firma y año, y
-- cada empresa marca las obligaciones que tiene; la app calcula sus vencimientos con el último dígito
-- del NIT. Se editan en línea, como la UVT (D-024), y bajan a todos los PC con la descarga de cambios.
-- =============================================================================================

create table public.calendario_firma (
  firma_id  uuid not null references public.firmas (id) on delete cascade,
  anio      smallint not null check (anio between 2000 and 2100),
  -- [{"obligacion", "nombre", "periodo", "digito" (0-9 o null), "fecha"}]
  filas     jsonb not null check (jsonb_typeof(filas) = 'array'),
  primary key (firma_id, anio)
);
alter table public.calendario_firma enable row level security;
create policy calendario_ver on public.calendario_firma for select to authenticated using (public.es_miembro_firma(firma_id));
revoke all on public.calendario_firma from anon;
revoke insert, update, delete on public.calendario_firma from authenticated;

create table public.obligaciones_empresa (
  empresa_id  uuid primary key references public.empresas (id),
  codigos     text[] not null default '{}'
);
alter table public.obligaciones_empresa enable row level security;
create policy obligaciones_ver on public.obligaciones_empresa for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
revoke all on public.obligaciones_empresa from anon;
revoke insert, update, delete on public.obligaciones_empresa from authenticated;

-- true si el texto es una fecha válida (pg_input_is_valid solo existe desde PostgreSQL 16).
create function public.es_fecha_valida(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  perform p::date;
  return true;
exception when others then
  return false;
end $$;

create function public.guardar_calendario(p_empresa uuid, p_anio int, p_filas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_firma uuid; v_mala jsonb;
begin
  if not public.puede(p_empresa, 'contabilidad', 'FULL') then
    raise exception 'SIN_PERMISO: solo el contador o el administrador cargan el calendario tributario' using errcode = '42501';
  end if;
  if p_anio is null or p_anio not between 2000 and 2100 then
    raise exception 'ANIO_INVALIDO: el año % no es válido', p_anio using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 3000 then
    raise exception 'DATOS_INVALIDOS: el calendario debe ser una lista de máximo 3.000 filas' using errcode = '22023';
  end if;
  -- Misma validación que la app: código, nombre, período, dígito y una fecha válida cercana al año.
  select f into v_mala from jsonb_array_elements(p_filas) f
   where coalesce(f ->> 'obligacion', '') !~ '^[A-Z0-9_-]{2,30}$'
      or length(trim(coalesce(f ->> 'nombre', ''))) not between 1 and 120
      or length(trim(coalesce(f ->> 'periodo', ''))) not between 1 and 20
      or (f ->> 'digito' is not null and f ->> 'digito' !~ '^[0-9]$')
      or case when coalesce(f ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' and public.es_fecha_valida(f ->> 'fecha')
              then extract(year from (f ->> 'fecha')::date) not between p_anio - 1 and p_anio + 1
              else true end
   limit 1;
  if v_mala is not null then
    raise exception 'DATOS_INVALIDOS: fila inválida en el calendario: %', v_mala using errcode = '22023';
  end if;
  select firma_id into v_firma from public.empresas where id = p_empresa;
  insert into public.calendario_firma (firma_id, anio, filas) values (v_firma, p_anio, p_filas)
  on conflict (firma_id, anio) do update set filas = excluded.filas;
  insert into public.cambios (empresa_id, tabla, registro_id, operacion)
  select e.id, 'calendario', p_anio::text, 'UPDATE' from public.empresas e where e.firma_id = v_firma;
  insert into public.auditoria (empresa_id, usuario_id, accion, tabla, registro_id, despues)
  values (p_empresa, auth.uid(), 'GUARDAR_CALENDARIO', 'calendario_firma', p_anio::text,
          jsonb_build_object('firma_id', v_firma, 'filas', jsonb_array_length(p_filas)));
end $$;

create function public.guardar_obligaciones(p_empresa uuid, p_codigos text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede(p_empresa, 'contabilidad', 'FULL') then
    raise exception 'SIN_PERMISO: solo el contador o el administrador definen las obligaciones' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_codigos) c where c !~ '^[A-Z0-9_-]{2,30}$') then
    raise exception 'DATOS_INVALIDOS: código de obligación inválido' using errcode = '22023';
  end if;
  insert into public.obligaciones_empresa (empresa_id, codigos)
  values (p_empresa, (select coalesce(array_agg(distinct c order by c), '{}') from unnest(p_codigos) c))
  on conflict (empresa_id) do update set codigos = excluded.codigos;
  insert into public.cambios (empresa_id, tabla, registro_id, operacion) values (p_empresa, 'obligaciones', 'obligaciones', 'UPDATE');
end $$;

-- Una empresa nueva recibe los calendarios que la firma ya cargó.
create function public.trg_calendario_empresa_nueva()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cambios (empresa_id, tabla, registro_id, operacion)
  select new.id, 'calendario', c.anio::text, 'INSERT' from public.calendario_firma c where c.firma_id = new.firma_id;
  return new;
end $$;
create trigger calendario_empresa_nueva after insert on public.empresas for each row execute function public.trg_calendario_empresa_nueva();

revoke execute on function public.guardar_calendario(uuid, int, jsonb), public.guardar_obligaciones(uuid, text[]) from public, anon;
grant execute on function public.guardar_calendario(uuid, int, jsonb), public.guardar_obligaciones(uuid, text[]) to authenticated;
revoke execute on function public.trg_calendario_empresa_nueva() from public, anon, authenticated;
revoke execute on function public.es_fecha_valida(text) from public, anon;
