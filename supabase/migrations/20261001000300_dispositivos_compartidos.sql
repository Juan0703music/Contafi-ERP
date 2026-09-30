-- Un mismo PC puede usarlo más de un usuario de la firma (caso común en oficinas contables).
-- El dispositivo se identifica por (id del PC, usuario): cada uno ve y actualiza solo su registro.
alter table public.dispositivos drop constraint dispositivos_pkey;
alter table public.dispositivos add primary key (id, usuario_id);

-- Registra (o actualiza) el PC del usuario actual y la hora de su última sincronización.
create function public.marcar_sincronizacion(p_id uuid, p_nombre text, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  insert into public.dispositivos (id, usuario_id, nombre, version_app, ultima_sync)
  values (p_id, auth.uid(), left(trim(p_nombre), 100), left(p_version, 50), now())
  on conflict (id, usuario_id) do update
    set nombre = excluded.nombre, version_app = excluded.version_app, ultima_sync = excluded.ultima_sync;
end $$;
revoke execute on function public.marcar_sincronizacion(uuid, text, text) from public, anon;
grant execute on function public.marcar_sincronizacion(uuid, text, text) to authenticated;
