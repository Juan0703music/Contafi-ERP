-- =============================================================================================
-- Inventario básico (sección 11.1): productos y kárdex por costo promedio.
--
-- El kárdex NO es una tabla aparte: se calcula a partir de las líneas contables que llevan producto y
-- cantidad (débito = entrada, crédito = salida). Así libros e inventario nunca se separan y todos los
-- PC llegan al mismo kárdex al sincronizar.
-- =============================================================================================

create table public.productos (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id),
  codigo             text not null,
  nombre             text not null,
  tipo               text not null default 'producto' check (tipo in ('producto', 'servicio')),
  unidad             text not null default 'UND',
  cuenta_inventario  text not null default '143505',
  iva_tipo           text not null default 'gravado' check (iva_tipo in ('gravado', 'exento', 'excluido')),
  iva_tarifa_ppm     bigint check (iva_tarifa_ppm between 0 and 1000000),
  precio_venta       numeric(18, 2) check (precio_venta >= 0),
  activo             boolean not null default true,
  unique (empresa_id, codigo),
  unique (empresa_id, id),
  foreign key (empresa_id, cuenta_inventario) references public.cuentas (empresa_id, codigo)
);
alter table public.productos enable row level security;
create policy productos_ver on public.productos for select to authenticated using (public.tiene_acceso_empresa(empresa_id));
create policy productos_crear on public.productos for insert to authenticated with check (public.puede(empresa_id, 'inventario', 'CREATE'));
create policy productos_editar on public.productos for update to authenticated using (public.puede(empresa_id, 'inventario', 'CREATE'));
create trigger cambio_productos after insert or update on public.productos for each row execute function public.trg_registrar_cambio();
revoke all on public.productos from anon;

-- Las líneas sobre inventario llevan producto y cantidad (en unidades, con hasta 3 decimales).
alter table public.lineas add column producto_id uuid;
alter table public.lineas add column cantidad numeric(18, 3);
alter table public.lineas add constraint lineas_producto_cantidad
  check ((producto_id is null) = (cantidad is null) and (cantidad is null or cantidad > 0));
alter table public.lineas add constraint lineas_producto_fk
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id);

-- Registro de comprobantes: igual que antes, ahora con producto y cantidad en las líneas.
create or replace function public.registrar_comprobante(p jsonb)
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
                               debito, credito, base_impuesto, nota, producto_id, cantidad)
    select v_id, v_empresa, l.ord::smallint, l.v ->> 'cuenta', (l.v ->> 'tercero_id')::uuid,
           (l.v ->> 'centro_costo_id')::uuid, coalesce((l.v ->> 'debito')::numeric, 0),
           coalesce((l.v ->> 'credito')::numeric, 0), (l.v ->> 'base_impuesto')::numeric, l.v ->> 'nota',
           (l.v ->> 'producto_id')::uuid, (l.v ->> 'cantidad')::numeric
      from jsonb_array_elements(p -> 'lineas') with ordinality as l(v, ord);

    if public.puede(v_empresa, 'contabilidad', 'APPROVE') then
      v_numero := public.contabilizar_interno(v_id);
      v_estado := 'contabilizado';
    else
      v_estado := 'borrador';
    end if;
  exception when others then
    return jsonb_build_object('id', v_id, 'estado', 'rechazado', 'numero', null, 'motivo', sqlerrm, 'repetido', false);
  end;

  return jsonb_build_object('id', v_id, 'estado', v_estado, 'numero', v_numero, 'motivo', null, 'repetido', false);
end $$;

-- Anulación: el reverso conserva producto y cantidad (anular una venta devuelve las unidades al kárdex).
create or replace function public.anular_comprobante(p_id uuid, p_motivo text, p_fecha date default null, p_clave text default null)
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
                 'debito', l.credito, 'credito', l.debito, 'base_impuesto', l.base_impuesto, 'nota', l.nota,
                 'producto_id', l.producto_id, 'cantidad', l.cantidad)
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

-- Productos creados sin conexión: como los terceros, si otro PC ya creó el mismo código se devuelve
-- el id del servidor. SECURITY INVOKER: aplican RLS y los permisos de inventario.
create function public.registrar_producto(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_resultado uuid;
begin
  if not public.puede(v_empresa, 'inventario', 'CREATE') then
    raise exception 'SIN_PERMISO: no tiene permiso para registrar productos en esta empresa' using errcode = '42501';
  end if;
  if exists (select 1 from public.productos where id = v_id and empresa_id = v_empresa) then
    update public.productos
       set codigo = p ->> 'codigo', nombre = p ->> 'nombre', tipo = p ->> 'tipo', unidad = p ->> 'unidad',
           cuenta_inventario = p ->> 'cuenta_inventario', iva_tipo = p ->> 'iva_tipo',
           iva_tarifa_ppm = (p ->> 'iva_tarifa_ppm')::bigint, precio_venta = (p ->> 'precio_venta')::numeric,
           activo = coalesce((p ->> 'activo')::boolean, true)
     where id = v_id;
    return v_id;
  end if;
  insert into public.productos (id, empresa_id, codigo, nombre, tipo, unidad, cuenta_inventario, iva_tipo, iva_tarifa_ppm, precio_venta, activo)
  values (v_id, v_empresa, p ->> 'codigo', p ->> 'nombre', p ->> 'tipo', p ->> 'unidad', p ->> 'cuenta_inventario',
          p ->> 'iva_tipo', (p ->> 'iva_tarifa_ppm')::bigint, (p ->> 'precio_venta')::numeric, coalesce((p ->> 'activo')::boolean, true))
  on conflict (empresa_id, codigo) do update
    set nombre = excluded.nombre, tipo = excluded.tipo, unidad = excluded.unidad, cuenta_inventario = excluded.cuenta_inventario,
        iva_tipo = excluded.iva_tipo, iva_tarifa_ppm = excluded.iva_tarifa_ppm, precio_venta = excluded.precio_venta, activo = excluded.activo
  returning id into v_resultado;
  return v_resultado;
end $$;
revoke execute on function public.registrar_producto(jsonb) from public, anon;
grant execute on function public.registrar_producto(jsonb) to authenticated;
