-- =============================================================================================
-- Reglas que aprende la importación de la DIAN (sección 11.1, "la función estrella"): la cuenta y las
-- retenciones que el contador usa con cada proveedor. Antes las aprendía cada PC por su lado; ahora
-- viajan en el lote (también sin conexión) y bajan a todos los PC de la empresa.
-- =============================================================================================

create table public.reglas_proveedor (
  empresa_id      uuid not null references public.empresas (id),
  nit             text not null check (nit ~ '^[0-9]{5,15}$'),
  -- null = todavía no se aprendió (no borra lo que haya aprendido otro PC)
  cuenta          text,
  retenciones     text[],
  actualizado_en  timestamptz not null default now(),
  primary key (empresa_id, nit),
  foreign key (empresa_id, cuenta) references public.cuentas (empresa_id, codigo)
);
alter table public.reglas_proveedor enable row level security;
create policy reglas_ver on public.reglas_proveedor for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
revoke all on public.reglas_proveedor from anon;
revoke insert, update, delete on public.reglas_proveedor from authenticated;

-- Quien puede registrar comprobantes enseña reglas: es lo que pasa al importar. Gana lo último aprendido.
create function public.aprender_regla_proveedor(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_nit text := p ->> 'nit';
  v_cuenta text := nullif(p ->> 'cuenta', '');
  v_retenciones text[] := case when jsonb_typeof(p -> 'retenciones') = 'array'
                               then array(select jsonb_array_elements_text(p -> 'retenciones')) end;
begin
  if not public.puede(v_empresa, 'contabilidad', 'CREATE') then
    raise exception 'SIN_PERMISO: no tiene permiso para importar en esta empresa' using errcode = '42501';
  end if;
  if v_nit is null or v_nit !~ '^[0-9]{5,15}$' then
    raise exception 'NIT_INVALIDO: "%"', coalesce(v_nit, '') using errcode = '22023';
  end if;
  if v_cuenta is not null and not exists (select 1 from public.cuentas c where c.empresa_id = v_empresa and c.codigo = v_cuenta
                                            and c.acepta_movimiento and c.activa) then
    raise exception 'CUENTA_INVALIDA: la cuenta % no existe o no es auxiliar', v_cuenta using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_retenciones) r where r !~ '^[A-Z0-9-]{2,20}$') then
    raise exception 'DATOS_INVALIDOS: código de retención inválido' using errcode = '22023';
  end if;
  insert into public.reglas_proveedor (empresa_id, nit, cuenta, retenciones) values (v_empresa, v_nit, v_cuenta, v_retenciones)
  on conflict (empresa_id, nit) do update
    set cuenta = coalesce(excluded.cuenta, public.reglas_proveedor.cuenta),
        retenciones = coalesce(excluded.retenciones, public.reglas_proveedor.retenciones),
        actualizado_en = now();
  insert into public.cambios (empresa_id, tabla, registro_id, operacion) values (v_empresa, 'reglas_proveedor', v_nit, 'UPDATE');
end $$;
revoke execute on function public.aprender_regla_proveedor(jsonb) from public, anon;
grant execute on function public.aprender_regla_proveedor(jsonb) to authenticated;
