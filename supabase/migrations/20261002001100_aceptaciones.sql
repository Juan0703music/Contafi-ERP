-- =============================================================================================
-- Términos, licencia de uso y política de datos con registro de cada aceptación (checklist de
-- lanzamiento, sección 22; Ley 1581 de 2012: poder demostrar la autorización del titular).
--
-- Los textos los redacta el abogado. Cada versión se publica (publicado = true) cuando esté lista; la
-- app pide aceptar las versiones vigentes que el usuario no ha aceptado y lo registra aquí (solo agregar).
-- =============================================================================================

create table public.documentos_legales (
  codigo          text not null check (codigo in ('terminos', 'privacidad', 'transmision')),
  version         text not null,
  titulo          text not null,
  url             text not null,             -- página del sitio con el texto
  publicado       boolean not null default false,
  vigente_desde   timestamptz,
  primary key (codigo, version)
);
alter table public.documentos_legales enable row level security;
create policy documentos_ver on public.documentos_legales for select to anon, authenticated using (publicado);
revoke all on public.documentos_legales from anon;
revoke insert, update, delete, truncate on public.documentos_legales from authenticated;
grant select on public.documentos_legales to anon; -- el sitio muestra los publicados

-- Pendientes de publicar: el abogado entrega los textos y Contafi marca publicado = true.
insert into public.documentos_legales (codigo, version, titulo, url) values
  ('terminos', '1', 'Términos y condiciones y licencia de uso', '/terminos'),
  ('privacidad', '1', 'Política de tratamiento de datos personales', '/privacidad');

create table public.aceptaciones (
  usuario_id   uuid not null references public.usuarios (id) on delete cascade,
  codigo       text not null,
  version      text not null,
  aceptado_en  timestamptz not null default now(),
  primary key (usuario_id, codigo, version),
  foreign key (codigo, version) references public.documentos_legales (codigo, version)
);
alter table public.aceptaciones enable row level security;
create policy aceptaciones_propias on public.aceptaciones for select to authenticated using (usuario_id = auth.uid());
revoke insert, update, delete, truncate on public.aceptaciones from anon, authenticated;
revoke all on public.aceptaciones from anon;

-- Lo que falta aceptar: la versión vigente (la más reciente publicada) de cada documento.
create function public.documentos_pendientes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', d.codigo, 'version', d.version, 'titulo', d.titulo, 'url', d.url) order by d.codigo), '[]')
    from (select distinct on (codigo) * from public.documentos_legales where publicado order by codigo, vigente_desde desc nulls last, version desc) d
   where auth.uid() is not null
     and not exists (select 1 from public.aceptaciones a where a.usuario_id = auth.uid() and a.codigo = d.codigo and a.version = d.version)
$$;

create function public.aceptar_documentos(p_documentos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(p_documentos) x
              where not exists (select 1 from public.documentos_legales d
                                 where d.codigo = x ->> 'codigo' and d.version = x ->> 'version' and d.publicado)) then
    raise exception 'DOCUMENTO_INVALIDO: el documento o la versión no está publicado' using errcode = '22023';
  end if;
  insert into public.aceptaciones (usuario_id, codigo, version)
  select auth.uid(), x ->> 'codigo', x ->> 'version' from jsonb_array_elements(p_documentos) x
  on conflict do nothing;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, despues)
  values (auth.uid(), 'ACEPTAR_DOCUMENTOS', 'aceptaciones', auth.uid()::text, p_documentos);
end $$;

revoke execute on function public.documentos_pendientes(), public.aceptar_documentos(jsonb) from public, anon;
grant execute on function public.documentos_pendientes(), public.aceptar_documentos(jsonb) to authenticated;
