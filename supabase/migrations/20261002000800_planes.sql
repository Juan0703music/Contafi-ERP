-- =============================================================================================
-- Planes y suscripción (sección 17; Fase 7). Precios y límites viven en una tabla (no en el código).
--
-- Suscripción vencida = modo consulta: se puede ver y exportar todo, pero no escribir. Se aplica en
-- public.puede (CREATE o más), así el servidor rechaza el lote ENTERO y lo pendiente se queda en la cola
-- del PC hasta renovar: nunca se pierde nada ni se rechaza un comprobante por falta de pago.
-- =============================================================================================

create table public.planes (
  codigo                    text primary key,
  nombre                    text not null,
  usuarios_max              int not null check (usuarios_max > 0),
  empresas_max              int not null check (empresas_max > 0),
  precio_mensual            numeric(12, 2) not null check (precio_mensual >= 0),   -- antes de IVA
  precio_empresa_adicional  numeric(12, 2) not null default 0,
  orden                     smallint not null default 0
);
alter table public.planes enable row level security;
create policy planes_ver on public.planes for select to authenticated using (true);
revoke all on public.planes from anon;
revoke insert, update, delete on public.planes from authenticated;

insert into public.planes (codigo, nombre, usuarios_max, empresas_max, precio_mensual, precio_empresa_adicional, orden) values
  ('prueba', 'Prueba gratis (30 días)', 1, 1, 0, 0, 0),
  ('independiente', 'Independiente', 1, 10, 119000, 10000, 1),
  ('firma', 'Firma', 3, 30, 299000, 10000, 2),
  ('firma_plus', 'Firma Plus', 8, 80, 649000, 10000, 3);

alter table public.firmas
  add column prueba_hasta date not null default (current_date + 30),
  add column pagado_hasta date,
  add column empresas_adicionales int not null default 0 check (empresas_adicionales >= 0),
  add column fundador boolean not null default false;
alter table public.firmas add constraint firmas_plan_fk foreign key (plan) references public.planes (codigo);
-- Plan, pagos y estado solo los cambia Contafi (cobros), nunca la app.
revoke insert, update, delete on public.firmas from authenticated, anon;

-- Días de gracia después del vencimiento de un plan pago (el cobro puede tardar).
create function public.firma_activa(p_firma uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select f.estado = 'activa' and case f.plan
             when 'prueba' then current_date <= f.prueba_hasta
             else f.pagado_hasta is null or current_date <= f.pagado_hasta + 15
           end
      from public.firmas f where f.id = p_firma), false)
$$;

create or replace function public.puede(p_empresa uuid, p_modulo text, p_minimo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.nivel_permiso(public.rol_en_empresa(p_empresa), p_modulo), 0)
         >= case p_minimo when 'READ' then 1 when 'CREATE' then 2 when 'APPROVE' then 3 when 'FULL' then 4 else 99 end
     -- Con la suscripción vencida solo se consulta.
     and (p_minimo = 'READ' or public.firma_activa((select e.firma_id from public.empresas e where e.id = p_empresa)))
$$;

-- Estado de la suscripción para la app (cualquier miembro de la firma).
create function public.estado_suscripcion(p_firma uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_f public.firmas; v_p public.planes;
begin
  if not public.es_miembro_firma(p_firma) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_f from public.firmas where id = p_firma;
  select * into v_p from public.planes where codigo = v_f.plan;
  return jsonb_build_object(
    'plan', v_p.codigo, 'nombre', v_p.nombre, 'estado', v_f.estado, 'activa', public.firma_activa(p_firma),
    'usuarios_max', v_p.usuarios_max, 'empresas_max', v_p.empresas_max + v_f.empresas_adicionales,
    'usuarios', (select count(*) from public.membresias m where m.firma_id = p_firma),
    'invitaciones', (select count(*) from public.invitaciones i where i.firma_id = p_firma and i.aceptada_en is null and i.revocada_en is null and i.expira_en > now()),
    'empresas', (select count(*) from public.empresas e where e.firma_id = p_firma and e.activa),
    'prueba_hasta', v_f.prueba_hasta, 'pagado_hasta', v_f.pagado_hasta, 'fundador', v_f.fundador,
    'dias_restantes', case when v_f.plan = 'prueba' then v_f.prueba_hasta - current_date
                           when v_f.pagado_hasta is not null then v_f.pagado_hasta - current_date end);
end $$;

-- Límites del plan al crear empresas e invitar personas (las invitaciones pendientes cuentan como puestos).
create function public.trg_limite_empresas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_uso int;
begin
  if not public.firma_activa(new.firma_id) then
    raise exception 'SUSCRIPCION_VENCIDA: la suscripción de la firma venció; renuévela para crear empresas' using errcode = '42501';
  end if;
  select p.empresas_max + f.empresas_adicionales into v_max
    from public.firmas f join public.planes p on p.codigo = f.plan where f.id = new.firma_id;
  select count(*) into v_uso from public.empresas where firma_id = new.firma_id and activa;
  if v_uso >= v_max then
    raise exception 'LIMITE_PLAN: el plan de la firma permite % empresa(s); agregue empresas adicionales o cambie de plan', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger limite_empresas before insert on public.empresas for each row execute function public.trg_limite_empresas();

create function public.trg_limite_usuarios()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_uso int;
begin
  if not public.firma_activa(new.firma_id) then
    raise exception 'SUSCRIPCION_VENCIDA: la suscripción de la firma venció; renuévela para invitar personas' using errcode = '42501';
  end if;
  select p.usuarios_max into v_max from public.firmas f join public.planes p on p.codigo = f.plan where f.id = new.firma_id;
  select (select count(*) from public.membresias where firma_id = new.firma_id)
       + (select count(*) from public.invitaciones where firma_id = new.firma_id and aceptada_en is null and revocada_en is null and expira_en > now())
    into v_uso;
  if v_uso >= v_max then
    raise exception 'LIMITE_PLAN: el plan de la firma permite % usuario(s), contando las invitaciones pendientes; cambie de plan o revoque una invitación', v_max
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger limite_usuarios before insert on public.invitaciones for each row execute function public.trg_limite_usuarios();

-- Para la API de sincronización: distinguir "sin permiso" de "suscripción vencida" (mensaje claro).
create function public.suscripcion_activa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.tiene_acceso_empresa(p_empresa) and public.firma_activa((select e.firma_id from public.empresas e where e.id = p_empresa))
$$;

revoke execute on function public.estado_suscripcion(uuid), public.suscripcion_activa(uuid) from public, anon;
grant execute on function public.estado_suscripcion(uuid), public.suscripcion_activa(uuid) to authenticated;
revoke execute on function public.firma_activa(uuid), public.trg_limite_empresas(), public.trg_limite_usuarios() from public, anon, authenticated;
