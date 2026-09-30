-- =============================================================================================
-- Terceros creados sin conexión (sección 9.4: datos maestros, gana el último cambio confirmado)
--
-- La app crea terceros con un UUID propio mientras está sin internet. Al sincronizar:
--   * si el id ya existe en el servidor, se actualiza (el cambio anterior queda en auditoría);
--   * si otro PC ya creó el mismo documento (tipo_doc + número), se devuelve el id del servidor
--     y la app reescribe sus referencias locales antes de enviar los comprobantes.
-- SECURITY INVOKER: se aplican RLS y los permisos del usuario (terceros_crear / terceros_editar).
-- =============================================================================================

create function public.registrar_tercero(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_resultado uuid;
begin
  if not public.puede(v_empresa, 'contabilidad', 'CREATE') then
    raise exception 'SIN_PERMISO: no tiene permiso para registrar terceros en esta empresa' using errcode = '42501';
  end if;

  if exists (select 1 from public.terceros where id = v_id and empresa_id = v_empresa) then
    update public.terceros
       set tipo_doc = p ->> 'tipo_doc', numero = p ->> 'numero', dv = (p ->> 'dv')::smallint,
           nombre = p ->> 'nombre',
           tipos = coalesce(array(select jsonb_array_elements_text(p -> 'tipos')), '{}'),
           responsabilidades = coalesce(array(select jsonb_array_elements_text(p -> 'responsabilidades')), '{}'),
           direccion = p ->> 'direccion', municipio = p ->> 'municipio', correo = p ->> 'correo',
           activo = coalesce((p ->> 'activo')::boolean, true)
     where id = v_id;
    return v_id;
  end if;

  insert into public.terceros (id, empresa_id, tipo_doc, numero, dv, nombre, tipos, responsabilidades,
                               direccion, municipio, correo, activo)
  values (v_id, v_empresa, p ->> 'tipo_doc', p ->> 'numero', (p ->> 'dv')::smallint, p ->> 'nombre',
          coalesce(array(select jsonb_array_elements_text(p -> 'tipos')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p -> 'responsabilidades')), '{}'),
          p ->> 'direccion', p ->> 'municipio', p ->> 'correo', coalesce((p ->> 'activo')::boolean, true))
  on conflict (empresa_id, tipo_doc, numero) do update
    set nombre = excluded.nombre, dv = excluded.dv, tipos = excluded.tipos,
        responsabilidades = excluded.responsabilidades, direccion = excluded.direccion,
        municipio = excluded.municipio, correo = excluded.correo, activo = excluded.activo
  returning id into v_resultado;
  return v_resultado;
end $$;

revoke execute on function public.registrar_tercero(jsonb) from public, anon;
grant execute on function public.registrar_tercero(jsonb) to authenticated;
