-- =============================================================================================
-- Endurecimiento (checklist de lanzamiento, sección 22: "pruebas de RLS y revisión de seguridad").
-- Hallazgos de la auditoría automática (test/seguridad.test.ts):
--   1. Los privilegios por defecto de Supabase dan TRUNCATE a anon y authenticated. TRUNCATE ignora
--      RLS (vaciaría la tabla de TODAS las firmas). PostgREST no lo expone, pero se cierra igual.
--   2. Un administrador podía insertar empresas directamente, sin crear_empresa (DV, PUC, tipos).
--   3. Sin sesión se podían ejecutar las funciones auxiliares de permisos y las de trigger (no
--      exponían datos: sin sesión todo da falso), pero no hay por qué.
-- =============================================================================================

revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

revoke insert on public.empresas from authenticated;
drop policy if exists empresas_crear on public.empresas;

revoke execute on function public.dv_nit(text), public.es_admin_firma(uuid), public.es_miembro_firma(uuid), public.hash_token(text),
  public.nivel_autenticacion(), public.nivel_permiso(public.rol_empresa, text), public.puede(uuid, text, text), public.requiere_mfa(),
  public.rol_en_empresa(uuid), public.tiene_acceso_empresa(uuid)
  from public, anon;
-- Las políticas de RLS las usan con la sesión del usuario: authenticated sí las necesita.
grant execute on function public.dv_nit(text), public.es_admin_firma(uuid), public.es_miembro_firma(uuid), public.hash_token(text),
  public.nivel_autenticacion(), public.nivel_permiso(public.rol_empresa, text), public.puede(uuid, text, text), public.requiere_mfa(),
  public.rol_en_empresa(uuid), public.tiene_acceso_empresa(uuid)
  to authenticated;

-- Las funciones de trigger solo las ejecuta el motor de la base al disparar el trigger.
revoke execute on function public.trg_auditoria_solo_agregar(), public.trg_empresa_linea(), public.trg_inmutabilidad_comprobante(),
  public.trg_inmutabilidad_lineas(), public.trg_nuevo_usuario(), public.trg_registrar_cambio(), public.trg_validar_contabilizacion()
  from public, anon, authenticated;
