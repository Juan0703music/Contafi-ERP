-- =============================================================================================
-- CONTAFI — Autenticación, MFA, alta de firmas y empresas, invitaciones (Fase 2)
--
-- El registro, el inicio de sesión y el MFA (TOTP) los maneja Supabase Auth. Aquí:
--   * se crea el perfil en public.usuarios al registrarse;
--   * los administradores de una firma solo ejercen como tales con MFA verificado (aal2);
--   * se crean firmas y empresas (con PUC y tipos de comprobante);
--   * se invita a usuarios a la firma y a cada empresa con un rol.
-- =============================================================================================

-- ------------------------------------------------------------------ corrección de seguridad
-- Supabase otorga EXECUTE a anon y authenticated sobre toda función nueva del esquema public.
-- contabilizar_interno no revisa permisos (lo hacen quienes la llaman): no debe ser invocable.
revoke execute on function public.contabilizar_interno(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ perfil al registrarse

create function public.trg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usuarios (id, nombre, correo)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1)),
          lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger al_registrarse after insert on auth.users
  for each row execute function public.trg_nuevo_usuario();

-- ------------------------------------------------------------------ MFA obligatorio para administradores (sección 10)

-- Nivel de autenticación de la sesión: aal1 (contraseña) o aal2 (contraseña + TOTP verificado).
create function public.nivel_autenticacion()
returns text language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

-- Un administrador sin MFA verificado en la sesión no ejerce como administrador.
create or replace function public.es_admin_firma(p_firma uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.nivel_autenticacion() = 'aal2' and exists (
    select 1 from public.membresias m
    where m.firma_id = p_firma and m.usuario_id = auth.uid() and m.rol in ('propietario', 'administrador')
  )
$$;

-- La app lo consulta tras iniciar sesión: true = debe pedir (o configurar) el código TOTP.
create function public.requiere_mfa()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.nivel_autenticacion() <> 'aal2' and exists (
    select 1 from public.membresias m
    where m.usuario_id = auth.uid() and m.rol in ('propietario', 'administrador')
  )
$$;

-- ------------------------------------------------------------------ firmas y empresas

-- Dígito de verificación del NIT (igual a @contafi/shared calcularDV).
create function public.dv_nit(p_nit text)
returns smallint language plpgsql immutable set search_path = '' as $$
declare
  pesos int[] := array[3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  d text := regexp_replace(p_nit, '\D', '', 'g');
  s int := 0;
  r int;
begin
  if length(d) = 0 or length(d) > 15 then
    raise exception 'NIT_INVALIDO: "%"', p_nit using errcode = '22023';
  end if;
  for i in 1 .. length(d) loop
    s := s + substr(d, length(d) - i + 1, 1)::int * pesos[i];
  end loop;
  r := s % 11;
  return case when r > 1 then 11 - r else r end;
end $$;

-- Alta de una firma contable: quien la crea queda como propietario.
create function public.crear_firma(p_nombre text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'FALTA_NOMBRE: la firma debe tener un nombre' using errcode = '22023';
  end if;
  insert into public.firmas (nombre) values (trim(p_nombre)) returning id into v_id;
  insert into public.membresias (firma_id, usuario_id, rol) values (v_id, auth.uid(), 'propietario');
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, despues)
  values (auth.uid(), 'CREAR_FIRMA', 'firmas', v_id::text, jsonb_build_object('nombre', trim(p_nombre)));
  return v_id;
end $$;

-- Alta de una empresa cliente con la plantilla del PUC y los tipos de comprobante estándar.
create function public.crear_empresa(
  p_firma uuid, p_nit text, p_dv smallint, p_razon_social text,
  p_grupo_niif smallint default 2, p_municipio text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_nit text := regexp_replace(p_nit, '\D', '', 'g');
begin
  if not public.es_admin_firma(p_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) puede crear empresas' using errcode = '42501';
  end if;
  if p_dv is distinct from public.dv_nit(v_nit) then
    raise exception 'DV_INVALIDO: el dígito de verificación del NIT % es %', v_nit, public.dv_nit(v_nit) using errcode = '22023';
  end if;

  insert into public.empresas (firma_id, nit, dv, razon_social, grupo_niif, municipio)
  values (p_firma, v_nit, p_dv, trim(p_razon_social), p_grupo_niif, p_municipio)
  returning id into v_id;

  insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero)
  select v_id, p.codigo, p.nombre, p.naturaleza,
         case length(p.codigo) when 1 then 1 when 2 then 2 when 4 then 3 when 6 then 4 else 5 end,
         not exists (select 1 from public.plantilla_puc h where h.codigo like p.codigo || '%' and h.codigo <> p.codigo),
         p.exige_tercero
    from public.plantilla_puc p;

  insert into public.tipos_comprobante (empresa_id, codigo, nombre, prefijo) values
    (v_id, 'CG', 'Comprobante general', 'CG'),
    (v_id, 'SI', 'Saldos iniciales', 'SI'),
    (v_id, 'FV', 'Factura de venta', 'FV'),
    (v_id, 'FC', 'Factura de compra', 'FC'),
    (v_id, 'NC', 'Nota crédito', 'NC'),
    (v_id, 'ND', 'Nota débito', 'ND'),
    (v_id, 'RC', 'Recibo de caja', 'RC'),
    (v_id, 'CE', 'Comprobante de egreso', 'CE'),
    (v_id, 'CC', 'Comprobante de cierre', 'CC');
  return v_id;
end $$;

-- ------------------------------------------------------------------ invitaciones

create table public.invitaciones (
  id            uuid primary key default gen_random_uuid(),
  firma_id      uuid not null references public.firmas (id) on delete cascade,
  correo        text not null check (correo = lower(correo) and correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rol_firma     public.rol_firma not null default 'miembro' check (rol_firma <> 'propietario'),
  -- [{"empresa_id": "...", "rol": "Contador"}]
  empresas      jsonb not null default '[]' check (jsonb_typeof(empresas) = 'array'),
  -- Solo se guarda el hash del token; el token viaja una sola vez, en el correo.
  token_hash    text not null unique,
  invitado_por  uuid references public.usuarios (id),
  creado_en     timestamptz not null default now(),
  expira_en     timestamptz not null default now() + interval '7 days',
  aceptada_por  uuid references public.usuarios (id),
  aceptada_en   timestamptz,
  revocada_en   timestamptz
);
alter table public.invitaciones enable row level security;
create policy invitaciones_ver on public.invitaciones for select to authenticated using (public.es_admin_firma(firma_id));

create function public.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

/*
  Invita a un correo a la firma y, opcionalmente, a empresas con un rol en cada una.
  Devuelve {"id", "token"}: la API envía el token por correo y no lo guarda.
*/
create function public.invitar_usuario(p_firma uuid, p_correo text, p_rol_firma public.rol_firma, p_empresas jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_ajena uuid;
begin
  if not public.es_admin_firma(p_firma) then
    raise exception 'SIN_PERMISO: solo un administrador de la firma (con MFA) puede invitar' using errcode = '42501';
  end if;
  if p_rol_firma = 'propietario' then
    raise exception 'ROL_INVALIDO: no se puede invitar como propietario' using errcode = '22023';
  end if;
  -- Todas las empresas deben ser de la firma y los roles deben existir.
  select (e ->> 'empresa_id')::uuid into v_ajena
    from jsonb_array_elements(coalesce(p_empresas, '[]')) e
   where not exists (select 1 from public.empresas x where x.id = (e ->> 'empresa_id')::uuid and x.firma_id = p_firma)
   limit 1;
  if v_ajena is not null then
    raise exception 'EMPRESA_AJENA: la empresa % no pertenece a la firma', v_ajena using errcode = '22023';
  end if;
  perform (e ->> 'rol')::public.rol_empresa from jsonb_array_elements(coalesce(p_empresas, '[]')) e;

  insert into public.invitaciones (firma_id, correo, rol_firma, empresas, token_hash, invitado_por)
  values (p_firma, lower(trim(p_correo)), p_rol_firma, coalesce(p_empresas, '[]'), public.hash_token(v_token), auth.uid())
  returning id into v_id;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, despues)
  values (auth.uid(), 'INVITAR', 'invitaciones', v_id::text,
          jsonb_build_object('firma_id', p_firma, 'correo', lower(trim(p_correo)), 'rol_firma', p_rol_firma, 'empresas', p_empresas));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Acepta la invitación con la sesión del usuario invitado (el correo de la sesión debe coincidir).
create function public.aceptar_invitacion(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.invitaciones;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  select * into v_inv from public.invitaciones where token_hash = public.hash_token(p_token) for update;
  -- Mensaje único para no revelar si el token existe.
  if not found or v_inv.aceptada_en is not null or v_inv.revocada_en is not null or v_inv.expira_en < now() then
    raise exception 'INVITACION_INVALIDA: la invitación no existe, ya se usó, fue revocada o venció' using errcode = '22023';
  end if;
  if v_inv.correo <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'INVITACION_OTRO_CORREO: la invitación es para otro correo' using errcode = '42501';
  end if;

  insert into public.membresias (firma_id, usuario_id, rol) values (v_inv.firma_id, auth.uid(), v_inv.rol_firma)
  on conflict (firma_id, usuario_id) do nothing;
  insert into public.empresa_permisos (empresa_id, usuario_id, rol)
  select (e ->> 'empresa_id')::uuid, auth.uid(), (e ->> 'rol')::public.rol_empresa
    from jsonb_array_elements(v_inv.empresas) e
  on conflict (empresa_id, usuario_id) do update set rol = excluded.rol;

  update public.invitaciones set aceptada_por = auth.uid(), aceptada_en = now() where id = v_inv.id;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id)
  values (auth.uid(), 'ACEPTAR_INVITACION', 'invitaciones', v_inv.id::text);
  return v_inv.firma_id;
end $$;

create function public.revocar_invitacion(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_firma uuid;
begin
  select firma_id into v_firma from public.invitaciones where id = p_id;
  if v_firma is null or not public.es_admin_firma(v_firma) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  update public.invitaciones set revocada_en = now() where id = p_id and aceptada_en is null;
end $$;

-- ------------------------------------------------------------------ privilegios

revoke all on public.invitaciones, public.plantilla_puc from anon;
revoke insert, update, delete, truncate on public.invitaciones, public.plantilla_puc from authenticated;
revoke execute on function public.crear_firma(text), public.crear_empresa(uuid, text, smallint, text, smallint, text),
  public.invitar_usuario(uuid, text, public.rol_firma, jsonb), public.aceptar_invitacion(text),
  public.revocar_invitacion(uuid), public.registrar_comprobante(jsonb), public.aprobar_comprobante(uuid),
  public.anular_comprobante(uuid, text, date, text), public.cambiar_estado_periodo(uuid, int, int, text)
  from public, anon;
grant execute on function public.crear_firma(text), public.crear_empresa(uuid, text, smallint, text, smallint, text),
  public.invitar_usuario(uuid, text, public.rol_firma, jsonb), public.aceptar_invitacion(text),
  public.revocar_invitacion(uuid), public.requiere_mfa()
  to authenticated;
