-- =============================================================================================
-- Estructura completa del PUC (Decreto 2650 de 1993): las 9 clases y todos sus grupos.
--
-- La plantilla traía solo los grupos con cuentas de la semilla. Como las empresas no pueden crear clases
-- ni grupos, una empresa con, por ejemplo, inversiones (12) o intangibles (16) no podía migrar su plan de
-- cuentas. Fuente: ESTRUCTURA_PUC en packages/shared/src/puc.ts (una prueba verifica que coincidan).
-- Además, una clase o un grupo nunca recibe movimientos, aunque no tenga cuentas debajo, y no se edita.
-- =============================================================================================

insert into public.plantilla_puc (codigo, nombre, naturaleza) values
  ('1', 'ACTIVO', 'D'),
  ('11', 'Disponible', 'D'),
  ('12', 'Inversiones', 'D'),
  ('13', 'Deudores', 'D'),
  ('14', 'Inventarios', 'D'),
  ('15', 'Propiedades, planta y equipo', 'D'),
  ('16', 'Intangibles', 'D'),
  ('17', 'Diferidos', 'D'),
  ('18', 'Otros activos', 'D'),
  ('19', 'Valorizaciones', 'D'),
  ('2', 'PASIVO', 'C'),
  ('21', 'Obligaciones financieras', 'C'),
  ('22', 'Proveedores', 'C'),
  ('23', 'Cuentas por pagar', 'C'),
  ('24', 'Impuestos, gravámenes y tasas', 'C'),
  ('25', 'Obligaciones laborales', 'C'),
  ('26', 'Pasivos estimados y provisiones', 'C'),
  ('27', 'Diferidos', 'C'),
  ('28', 'Otros pasivos', 'C'),
  ('29', 'Bonos y papeles comerciales', 'C'),
  ('3', 'PATRIMONIO', 'C'),
  ('31', 'Capital social', 'C'),
  ('32', 'Superávit de capital', 'C'),
  ('33', 'Reservas', 'C'),
  ('34', 'Revalorización del patrimonio', 'C'),
  ('35', 'Dividendos o participaciones decretados en acciones, cuotas o partes de interés social', 'C'),
  ('36', 'Resultados del ejercicio', 'C'),
  ('37', 'Resultados de ejercicios anteriores', 'C'),
  ('38', 'Superávit por valorizaciones', 'C'),
  ('4', 'INGRESOS', 'C'),
  ('41', 'Operacionales', 'C'),
  ('42', 'No operacionales', 'C'),
  ('47', 'Ajustes por inflación', 'C'),
  ('5', 'GASTOS', 'D'),
  ('51', 'Operacionales de administración', 'D'),
  ('52', 'Operacionales de ventas', 'D'),
  ('53', 'No operacionales', 'D'),
  ('54', 'Impuesto de renta y complementarios', 'D'),
  ('59', 'Ganancias y pérdidas', 'D'),
  ('6', 'COSTOS DE VENTAS', 'D'),
  ('61', 'Costo de ventas y de prestación de servicios', 'D'),
  ('62', 'Compras', 'D'),
  ('7', 'COSTOS DE PRODUCCIÓN O DE OPERACIÓN', 'D'),
  ('71', 'Materia prima', 'D'),
  ('72', 'Mano de obra directa', 'D'),
  ('73', 'Costos indirectos', 'D'),
  ('74', 'Contratos de servicios', 'D'),
  ('8', 'CUENTAS DE ORDEN DEUDORAS', 'D'),
  ('81', 'Derechos contingentes', 'D'),
  ('82', 'Deudoras fiscales', 'D'),
  ('83', 'Deudoras de control', 'D'),
  ('84', 'Derechos contingentes por contra (CR)', 'C'),
  ('85', 'Deudoras fiscales por contra (CR)', 'C'),
  ('86', 'Deudoras de control por contra (CR)', 'C'),
  ('9', 'CUENTAS DE ORDEN ACREEDORAS', 'C'),
  ('91', 'Responsabilidades contingentes', 'C'),
  ('92', 'Acreedoras fiscales', 'C'),
  ('93', 'Acreedoras de control', 'C'),
  ('94', 'Responsabilidades contingentes por contra (DB)', 'D'),
  ('95', 'Acreedoras fiscales por contra (DB)', 'D'),
  ('96', 'Acreedoras de control por contra (DB)', 'D')
on conflict (codigo) do nothing;

-- Las empresas que ya existen reciben los grupos que les faltan (bajan a los PC como cambios).
insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento)
select e.id, p.codigo, p.nombre, p.naturaleza, length(p.codigo), false
  from public.empresas e cross join public.plantilla_puc p
 where length(p.codigo) <= 2
on conflict (empresa_id, codigo) do nothing;
update public.cuentas set acepta_movimiento = false where length(codigo) <= 2 and acepta_movimiento;

create or replace function public.crear_empresa(
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

  -- Reciben movimientos las cuentas (4 dígitos o más) sin subcuentas; nunca las clases ni los grupos.
  insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero)
  select v_id, p.codigo, p.nombre, p.naturaleza,
         case length(p.codigo) when 1 then 1 when 2 then 2 when 4 then 3 when 6 then 4 else 5 end,
         length(p.codigo) >= 4 and not exists (select 1 from public.plantilla_puc h where h.codigo like p.codigo || '%' and h.codigo <> p.codigo),
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


-- Clases y grupos no se editan (antes se podía renombrar o inactivar un grupo existente).
create or replace function public.registrar_cuenta(p jsonb)
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
  -- Clases y grupos los fija la norma: no se crean ni se editan desde la app.
  if length(coalesce(v_codigo, '')) <= 2 then
    raise exception 'CODIGO_INVALIDO: las clases y los grupos los fija el PUC (Decreto 2650); no se modifican' using errcode = '22023';
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
