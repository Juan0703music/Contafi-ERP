-- =============================================================================================
-- Equipo de la firma desde la app (alta en la nube, sección 11.1): mis firmas, miembros con sus roles
-- por empresa, invitaciones pendientes, cambiar roles y quitar miembros.
--
-- Hasta ahora un administrador podía escribir membresías y permisos directamente (RLS "for all"): podía,
-- por ejemplo, quitarle la firma a su propietario. Ahora solo se cambian con estas funciones, que
-- aplican las reglas y dejan auditoría.
-- =============================================================================================

drop policy membresias_admin on public.membresias;
drop policy permisos_admin on public.empresa_permisos;
revoke insert, update, delete on public.membresias, public.empresa_permisos from authenticated, anon;

-- Firmas del usuario con su rol (para el asistente inicial y el selector de firma).
create function public.mis_firmas()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nombre', f.nombre, 'rol', m.rol) order by f.nombre), '[]')
    from public.membresias m join public.firmas f on f.id = m.firma_id
   where m.usuario_id = auth.uid()
$$;

-- Miembros (con su rol en cada empresa) e invitaciones pendientes. Solo administradores con MFA.
create function public.equipo_firma(p_firma uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_admin_firma(p_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) ve el equipo' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'miembros', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'usuario_id', u.id, 'nombre', u.nombre, 'correo', u.correo, 'rol_firma', m.rol,
               'empresas', (select coalesce(jsonb_agg(jsonb_build_object('empresa_id', p.empresa_id, 'rol', p.rol) order by e.razon_social), '[]')
                              from public.empresa_permisos p join public.empresas e on e.id = p.empresa_id
                             where p.usuario_id = u.id and e.firma_id = p_firma))
             order by (m.rol = 'propietario') desc, (m.rol = 'administrador') desc, u.nombre), '[]')
        from public.membresias m join public.usuarios u on u.id = m.usuario_id
       where m.firma_id = p_firma),
    'invitaciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'correo', i.correo, 'rol_firma', i.rol_firma, 'empresas', i.empresas,
               'creado_en', i.creado_en, 'expira_en', i.expira_en) order by i.creado_en desc), '[]')
        from public.invitaciones i
       where i.firma_id = p_firma and i.aceptada_en is null and i.revocada_en is null and i.expira_en > now()));
end $$;

-- Rol de un miembro en una empresa de la firma; null le quita el acceso a esa empresa.
create function public.asignar_rol_empresa(p_empresa uuid, p_usuario uuid, p_rol public.rol_empresa)
returns void language plpgsql security definer set search_path = '' as $$
declare v_firma uuid;
begin
  select firma_id into v_firma from public.empresas where id = p_empresa;
  if v_firma is null or not public.es_admin_firma(v_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) asigna roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membresias where firma_id = v_firma and usuario_id = p_usuario) then
    raise exception 'NO_ES_MIEMBRO: el usuario no pertenece a la firma; invítelo primero' using errcode = '22023';
  end if;
  if p_rol is null then
    delete from public.empresa_permisos where empresa_id = p_empresa and usuario_id = p_usuario;
  else
    insert into public.empresa_permisos (empresa_id, usuario_id, rol) values (p_empresa, p_usuario, p_rol)
    on conflict (empresa_id, usuario_id) do update set rol = excluded.rol;
  end if;
  insert into public.auditoria (empresa_id, usuario_id, accion, tabla, registro_id, despues)
  values (p_empresa, auth.uid(), 'ASIGNAR_ROL', 'empresa_permisos', p_usuario::text, jsonb_build_object('rol', p_rol));
end $$;

-- Administrador o miembro. Nadie se vuelve propietario por aquí y al propietario no se le cambia el rol.
create function public.cambiar_rol_firma(p_firma uuid, p_usuario uuid, p_rol public.rol_firma)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actual public.rol_firma;
begin
  if not public.es_admin_firma(p_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) cambia roles' using errcode = '42501';
  end if;
  select rol into v_actual from public.membresias where firma_id = p_firma and usuario_id = p_usuario for update;
  if v_actual is null then
    raise exception 'NO_ES_MIEMBRO: el usuario no pertenece a la firma' using errcode = '22023';
  end if;
  if v_actual = 'propietario' or p_rol = 'propietario' then
    raise exception 'ROL_INVALIDO: el rol de propietario no se asigna ni se quita desde la app' using errcode = '22023';
  end if;
  update public.membresias set rol = p_rol where firma_id = p_firma and usuario_id = p_usuario;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, despues)
  values (auth.uid(), 'CAMBIAR_ROL_FIRMA', 'membresias', p_usuario::text, jsonb_build_object('firma_id', p_firma, 'rol', p_rol));
end $$;

-- Saca a alguien de la firma y de todas sus empresas. Ni el propietario ni uno mismo.
create function public.quitar_miembro(p_firma uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actual public.rol_firma;
begin
  if not public.es_admin_firma(p_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) quita miembros' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'NO_A_SI_MISMO: no puede quitarse a sí mismo de la firma' using errcode = '22023';
  end if;
  select rol into v_actual from public.membresias where firma_id = p_firma and usuario_id = p_usuario for update;
  if v_actual is null then
    raise exception 'NO_ES_MIEMBRO: el usuario no pertenece a la firma' using errcode = '22023';
  end if;
  if v_actual = 'propietario' then
    raise exception 'ROL_INVALIDO: al propietario no se le puede quitar de la firma' using errcode = '22023';
  end if;
  delete from public.empresa_permisos p using public.empresas e
   where e.id = p.empresa_id and e.firma_id = p_firma and p.usuario_id = p_usuario;
  delete from public.membresias where firma_id = p_firma and usuario_id = p_usuario;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, despues)
  values (auth.uid(), 'QUITAR_MIEMBRO', 'membresias', p_usuario::text, jsonb_build_object('firma_id', p_firma));
end $$;

revoke execute on function public.mis_firmas(), public.equipo_firma(uuid), public.asignar_rol_empresa(uuid, uuid, public.rol_empresa),
  public.cambiar_rol_firma(uuid, uuid, public.rol_firma), public.quitar_miembro(uuid, uuid) from public, anon;
grant execute on function public.mis_firmas(), public.equipo_firma(uuid), public.asignar_rol_empresa(uuid, uuid, public.rol_empresa),
  public.cambiar_rol_firma(uuid, uuid, public.rol_firma), public.quitar_miembro(uuid, uuid) to authenticated;
