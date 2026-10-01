import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularDV, limpiarNit } from '@contafi/shared';
import type { BaseLocal, EmpresaLocal } from '@contafi/local';
import { crearEmpresaDemo } from './demo.ts';

/** Alta en la nube y equipo de la firma (sección 11.1). Todo lo decide el servidor; la app solo lo muestra. */

export type RolFirma = 'propietario' | 'administrador' | 'miembro';
export const ROLES_EMPRESA = ['SuperAdmin', 'Contador', 'AuxContable', 'Tesorero', 'Gerente', 'Auditor'] as const;
export type RolEmpresa = (typeof ROLES_EMPRESA)[number];
export const NOMBRE_ROL: Record<RolEmpresa, string> = {
  SuperAdmin: 'Administrador', Contador: 'Contador', AuxContable: 'Auxiliar contable', Tesorero: 'Tesorero', Gerente: 'Gerente (consulta)', Auditor: 'Auditor',
};

export interface FirmaUsuario { id: string; nombre: string; rol: RolFirma }
export interface AccesoEmpresa { empresa_id: string; rol: RolEmpresa }
export interface Miembro { usuario_id: string; nombre: string; correo: string; rol_firma: RolFirma; empresas: AccesoEmpresa[] }
export interface Invitacion { id: string; correo: string; rol_firma: RolFirma; empresas: AccesoEmpresa[]; creado_en: string; expira_en: string }
export interface Equipo { miembros: Miembro[]; invitaciones: Invitacion[] }
export interface EmpresaNueva { nit: string; razonSocial: string; grupoNiif: 1 | 2 | 3; municipio: string }

export interface ServicioFirma {
  misFirmas(): Promise<FirmaUsuario[]>;
  crearFirma(nombre: string): Promise<string>;
  crearEmpresa(firma: string, datos: EmpresaNueva): Promise<EmpresaLocal>;
  aceptarInvitacion(codigo: string): Promise<void>;
  equipo(firma: string): Promise<Equipo>;
  invitar(firma: string, correo: string, rolFirma: Exclude<RolFirma, 'propietario'>, empresas: AccesoEmpresa[]): Promise<void>;
  revocarInvitacion(id: string): Promise<void>;
  asignarRol(empresa: string, usuario: string, rol: RolEmpresa | null): Promise<void>;
  cambiarRolFirma(firma: string, usuario: string, rol: Exclude<RolFirma, 'propietario'>): Promise<void>;
  quitarMiembro(firma: string, usuario: string): Promise<void>;
}

export const esAdministrador = (f: FirmaUsuario | undefined) => f?.rol === 'propietario' || f?.rol === 'administrador';

/** Mensaje para el usuario a partir del error del servidor ("CODIGO: mensaje" → "Mensaje"). */
export function mensajeServidor(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? 'Error desconocido.';
  if (/fetch|network|Failed to/i.test(m)) return 'Esta acción requiere conexión a internet.';
  if (m === 'SIN_PERMISO') return 'No tiene permiso para esta acción.';
  if (m === 'SIN_SESION') return 'La sesión venció. Inicie sesión de nuevo.';
  const texto = m.replace(/^[A-Z_]{4,}: ?/, '');
  return texto.charAt(0).toUpperCase() + texto.slice(1) + (/[.!?]$/.test(texto) ? '' : '.');
}

function validarEmpresa(d: EmpresaNueva): { nit: string; dv: number } {
  const nit = limpiarNit(d.nit);
  if (!/^\d{5,15}$/.test(nit)) throw new Error('El NIT debe tener entre 5 y 15 dígitos.');
  if (!d.razonSocial.trim()) throw new Error('Escriba la razón social.');
  return { nit, dv: calcularDV(nit) };
}

// ------------------------------------------------------------------ nube

export function servicioFirmaNube(sb: SupabaseClient, api: string): ServicioFirma {
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(mensajeServidor(error));
    return data as T;
  }
  return {
    misFirmas: () => rpc<FirmaUsuario[]>('mis_firmas'),
    crearFirma: (nombre) => rpc<string>('crear_firma', { p_nombre: nombre }),
    async crearEmpresa(firma, d) {
      const { nit, dv } = validarEmpresa(d);
      const id = await rpc<string>('crear_empresa', {
        p_firma: firma, p_nit: nit, p_dv: dv, p_razon_social: d.razonSocial.trim(), p_grupo_niif: d.grupoNiif, p_municipio: d.municipio.trim() || null,
      });
      return { id, firma_id: firma, nit, dv, razon_social: d.razonSocial.trim() };
    },
    async aceptarInvitacion(codigo) {
      const limpio = codigo.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(limpio)) throw new Error('El código de invitación tiene 64 letras y números. Cópielo completo del enlace del correo.');
      await rpc('aceptar_invitacion', { p_token: limpio });
    },
    equipo: (firma) => rpc<Equipo>('equipo_firma', { p_firma: firma }),
    async invitar(firma, correo, rolFirma, empresas) {
      // La API envía el correo con el enlace (el token no pasa por la app).
      const { data } = await sb.auth.getSession();
      let res: Response;
      try {
        res = await fetch(`${api}/api/invitaciones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
          body: JSON.stringify({ firma_id: firma, correo: correo.trim().toLowerCase(), rol_firma: rolFirma, empresas }),
        });
      } catch {
        throw new Error('Invitar requiere conexión a internet.');
      }
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({})) as { mensaje?: string };
        throw new Error(mensajeServidor({ message: cuerpo.mensaje ?? `El servidor respondió ${res.status}.` }));
      }
    },
    revocarInvitacion: (id) => rpc('revocar_invitacion', { p_id: id }),
    asignarRol: (empresa, usuario, rol) => rpc('asignar_rol_empresa', { p_empresa: empresa, p_usuario: usuario, p_rol: rol }),
    cambiarRolFirma: (firma, usuario, rol) => rpc('cambiar_rol_firma', { p_firma: firma, p_usuario: usuario, p_rol: rol }),
    quitarMiembro: (firma, usuario) => rpc('quitar_miembro', { p_firma: firma, p_usuario: usuario }),
  };
}

// ------------------------------------------------------------------ demostración

/** Simulación en memoria, con las mismas reglas que el servidor, para mostrar el flujo a los pilotos. */
export function servicioFirmaDemo(base: BaseLocal, firma: FirmaUsuario, empresasIniciales: EmpresaLocal[]): ServicioFirma {
  const [a, b] = empresasIniciales;
  const equipo: Equipo = {
    miembros: [
      { usuario_id: 'yo', nombre: 'Invitado', correo: 'demostracion@contafi.co', rol_firma: 'propietario', empresas: [] },
      { usuario_id: 'u-maria', nombre: 'María Gómez', correo: 'maria.gomez@ejemplo.co', rol_firma: 'miembro',
        empresas: [a, b].filter(Boolean).map((e) => ({ empresa_id: e!.id, rol: 'Contador' as const })) },
      { usuario_id: 'u-jorge', nombre: 'Jorge Peña', correo: 'jorge.pena@ejemplo.co', rol_firma: 'miembro',
        empresas: a ? [{ empresa_id: a.id, rol: 'AuxContable' }] : [] },
    ],
    invitaciones: [],
  };
  const miembro = (id: string) => {
    const m = equipo.miembros.find((x) => x.usuario_id === id);
    if (!m) throw new Error('El usuario no pertenece a la firma.');
    return m;
  };
  const pausa = () => new Promise((r) => setTimeout(r, 250));
  return {
    misFirmas: async () => [firma],
    crearFirma: async () => firma.id,
    async crearEmpresa(firmaId, d) {
      const { nit, dv } = validarEmpresa(d);
      await pausa();
      return crearEmpresaDemo(base, { id: crypto.randomUUID(), firma_id: firmaId, nit, dv, razon_social: d.razonSocial.trim() });
    },
    aceptarInvitacion: async () => { throw new Error('En la demostración no hay invitaciones reales.'); },
    equipo: async () => structuredClone(equipo),
    async invitar(_f, correo, rolFirma, empresas) {
      const c = correo.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) throw new Error('Escriba un correo válido.');
      if (equipo.miembros.some((m) => m.correo === c)) throw new Error('Esa persona ya es de la firma.');
      await pausa();
      const ahora = new Date();
      equipo.invitaciones.unshift({ id: crypto.randomUUID(), correo: c, rol_firma: rolFirma, empresas,
        creado_en: ahora.toISOString(), expira_en: new Date(ahora.getTime() + 7 * 86_400_000).toISOString() });
    },
    async revocarInvitacion(id) { equipo.invitaciones = equipo.invitaciones.filter((i) => i.id !== id); },
    async asignarRol(empresa, usuario, rol) {
      const m = miembro(usuario);
      m.empresas = m.empresas.filter((x) => x.empresa_id !== empresa);
      if (rol) m.empresas.push({ empresa_id: empresa, rol });
    },
    async cambiarRolFirma(_f, usuario, rol) {
      const m = miembro(usuario);
      if (m.rol_firma === 'propietario') throw new Error('El rol de propietario no se asigna ni se quita desde la app.');
      m.rol_firma = rol;
    },
    async quitarMiembro(_f, usuario) {
      if (usuario === 'yo') throw new Error('No puede quitarse a sí mismo de la firma.');
      if (miembro(usuario).rol_firma === 'propietario') throw new Error('Al propietario no se le puede quitar de la firma.');
      equipo.miembros = equipo.miembros.filter((m) => m.usuario_id !== usuario);
    },
  };
}
