-- =============================================================================================
-- PUC personalizable (sección 11.1): crear cuentas, subcuentas y auxiliares; editar e inactivar.
--
-- Lo administra quien tiene contabilidad FULL (Contador y SuperAdmin), no "configuración": en
-- Colombia el plan de cuentas lo define el contador (D-022). Las cuentas solo se escriben por
-- registrar_cuenta, que aplica las reglas; nadie las cambia directamente (naturaleza, nivel y
-- "acepta movimiento" se derivan del código y del padre).
--
-- Funciona sin conexión: la cuenta viaja en el lote, antes que los productos y comprobantes que la usan.
-- =============================================================================================

drop policy cuentas_crear on public.cuentas;
drop policy cuentas_editar on public.cuentas;
revoke insert, update, delete on public.cuentas from authenticated, anon;

create function public.registrar_cuenta(p jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_codigo text := p ->> 'codigo';
  v_nombre text := trim(coalesce(p ->> 'nombre', ''));
  v_activa boolean := coalesce((p ->> 'activa')::boolean, true);
  v_actual public.cuentas;
  v_padre public.cuentas;
  v_saldo numeric;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;
  if not public.puede(v_empresa, 'contabilidad', 'FULL') then
    raise exception 'SIN_PERMISO: solo el contador o el administrador modifican el plan de cuentas' using errcode = '42501';
  end if;
  if v_nombre = '' or length(v_nombre) > 200 then
    raise exception 'NOMBRE_INVALIDO: el nombre de la cuenta es obligatorio (máximo 200 caracteres)' using errcode = '22023';
  end if;

  select * into v_actual from public.cuentas where empresa_id = v_empresa and codigo = v_codigo for update;
  if found then
    -- Edición: nombre, exigencias e inactivación. El código, la naturaleza y el nivel no cambian.
    if v_actual.activa and not v_activa then
      if exists (select 1 from public.cuentas h where h.empresa_id = v_empresa and h.activa
                    and h.codigo like v_codigo || '%' and h.codigo <> v_codigo) then
        raise exception 'TIENE_SUBCUENTAS: inactive primero las subcuentas de %', v_codigo using errcode = 'P0001';
      end if;
      select coalesce(sum(l.debito - l.credito), 0) into v_saldo
        from public.lineas l join public.comprobantes c on c.id = l.comprobante_id
       where l.empresa_id = v_empresa and l.cuenta = v_codigo and c.estado in ('contabilizado', 'anulado');
      if v_saldo <> 0 then
        raise exception 'CUENTA_CON_SALDO: la cuenta % tiene saldo %; trasládelo antes de inactivarla', v_codigo, v_saldo using errcode = 'P0001';
      end if;
    end if;
    update public.cuentas
       set nombre = v_nombre, activa = v_activa,
           exige_tercero = coalesce((p ->> 'exige_tercero')::boolean, false),
           exige_centro_costo = coalesce((p ->> 'exige_centro_costo')::boolean, false)
     where empresa_id = v_empresa and codigo = v_codigo
       and (nombre, activa, exige_tercero, exige_centro_costo) is distinct from
           (v_nombre, v_activa, coalesce((p ->> 'exige_tercero')::boolean, false), coalesce((p ->> 'exige_centro_costo')::boolean, false));
    return v_codigo;
  end if;

  -- Cuenta nueva. Clases y grupos los fija el PUC (Decreto 2650 de 1993): se crean cuentas (4 dígitos),
  -- subcuentas (6) y auxiliares (8, 10 o 12).
  if v_codigo is null or v_codigo !~ '^[1-9][0-9]*$' or length(v_codigo) not in (4, 6, 8, 10, 12) then
    raise exception 'CODIGO_INVALIDO: el código % no es válido; se crean cuentas de 4, 6, 8, 10 o 12 dígitos', coalesce(v_codigo, '') using errcode = '22023';
  end if;
  select * into v_padre from public.cuentas
   where empresa_id = v_empresa and codigo = left(v_codigo, case when length(v_codigo) = 4 then 2 else length(v_codigo) - 2 end)
   for update;
  if not found then
    raise exception 'SIN_CUENTA_PADRE: primero cree la cuenta %', left(v_codigo, case when length(v_codigo) = 4 then 2 else length(v_codigo) - 2 end)
      using errcode = 'P0001';
  end if;
  if not v_padre.activa then
    raise exception 'PADRE_INACTIVO: la cuenta % está inactiva', v_padre.codigo using errcode = 'P0001';
  end if;
  if v_padre.acepta_movimiento then
    -- El padre deja de ser auxiliar. Si ya tiene movimientos, sus saldos quedarían en una cuenta de título.
    if exists (select 1 from public.lineas where empresa_id = v_empresa and cuenta = v_padre.codigo) then
      raise exception 'PADRE_CON_MOVIMIENTOS: la cuenta % ya tiene movimientos; cree la auxiliar en otra subcuenta', v_padre.codigo
        using errcode = 'P0001';
    end if;
    update public.cuentas set acepta_movimiento = false where empresa_id = v_empresa and codigo = v_padre.codigo;
  end if;
  insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero, exige_centro_costo, activa)
  values (v_empresa, v_codigo, v_nombre, v_padre.naturaleza,
          case length(v_codigo) when 4 then 3 when 6 then 4 else 5 end, true,
          coalesce((p ->> 'exige_tercero')::boolean, false), coalesce((p ->> 'exige_centro_costo')::boolean, false), v_activa);
  return v_codigo;
end $$;
revoke execute on function public.registrar_cuenta(jsonb) from public, anon;
grant execute on function public.registrar_cuenta(jsonb) to authenticated;
