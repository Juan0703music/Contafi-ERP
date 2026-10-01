import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Icono } from '../componentes/comunes.tsx';
import { esAdministrador, mensajeServidor, type FirmaUsuario, type ServicioFirma } from '../datos/firma.ts';
import { MarcoAcceso, PasoMfa } from './Acceso.tsx';
import { CamposEmpresa, EMPRESA_VACIA } from './NuevaEmpresa.tsx';

type Paso =
  | { tipo: 'cargando' }
  | { tipo: 'inicio'; firmas: FirmaUsuario[] }
  | { tipo: 'mfa' }
  | { tipo: 'empresa'; firma: FirmaUsuario };

/**
 * Primer ingreso de un usuario sin empresas (alta en la nube): crear su firma —con verificación en dos
 * pasos y la primera empresa— o unirse a una firma con el código de su invitación.
 */
export function Bienvenida({ supabase, servicio, alListo, alSalir }: {
  supabase: SupabaseClient;
  servicio: ServicioFirma;
  /** Vuelve a intentar entrar; devuelve false si el usuario sigue sin empresas. */
  alListo: () => Promise<boolean>;
  alSalir: () => Promise<void>;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'cargando' });
  const [nombreFirma, setNombreFirma] = useState('');
  const [codigo, setCodigo] = useState('');
  const [empresa, setEmpresa] = useState(EMPRESA_VACIA);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Decide el paso según el estado en el servidor (así se retoma si se cerró la app a mitad). */
  const evaluar = useCallback(async () => {
    const { data: requiere, error: e1 } = await supabase.rpc('requiere_mfa');
    if (e1) throw new Error(mensajeServidor(e1));
    if (requiere) return setPaso({ tipo: 'mfa' });
    const firmas = await servicio.misFirmas();
    const admin = firmas.find(esAdministrador);
    setPaso(admin ? { tipo: 'empresa', firma: admin } : { tipo: 'inicio', firmas });
  }, [supabase, servicio]);

  useEffect(() => { evaluar().catch((e: Error) => { setError(e.message); setPaso({ tipo: 'inicio', firmas: [] }); }); }, [evaluar]);

  function trabajar(fn: () => Promise<void>) {
    return (e?: FormEvent) => {
      e?.preventDefault();
      setError(null);
      setOcupado(true);
      fn().catch((x: Error) => setError(x.message)).finally(() => setOcupado(false));
    };
  }

  const crearFirma = trabajar(async () => {
    if (!nombreFirma.trim()) throw new Error('Escriba el nombre de la firma.');
    await servicio.crearFirma(nombreFirma.trim());
    await evaluar(); // ahora es propietario: debe activar la verificación en dos pasos
  });

  const unirse = trabajar(async () => {
    await servicio.aceptarInvitacion(codigo);
    if (!(await alListo())) {
      setNota('Ya eres parte de la firma, pero todavía no te asignaron empresas. Pide a un administrador que te dé acceso.');
      await evaluar();
    }
  });

  const crearEmpresa = trabajar(async () => {
    if (paso.tipo !== 'empresa') return;
    await servicio.crearEmpresa(paso.firma.id, empresa);
    await alListo();
  });

  const salir = <button type="button" className="btn ghost block" onClick={() => void alSalir()}><Icono nombre="logout" />Cerrar sesión</button>;

  return (
    <MarcoAcceso>
      <section className="login-card" aria-labelledby="tituloAcceso">
        {paso.tipo === 'cargando' && <div><h2 id="tituloAcceso">Bienvenido</h2><p className="login-lead">Revisando tu cuenta…</p></div>}

        {paso.tipo === 'mfa' && (
          <PasoMfa supabase={supabase} alVerificar={() => evaluar()}
            motivo="Como propietario de la firma, tu cuenta necesita verificación en dos pasos." />)}

        {paso.tipo === 'inicio' && (
          <>
            <div><h2 id="tituloAcceso">Bienvenido a Contafi</h2>
              <p className="login-lead">{paso.firmas.length
                ? `Eres parte de ${paso.firmas.map((f) => f.nombre).join(', ')}, pero aún no tienes empresas asignadas.`
                : 'Tu cuenta todavía no pertenece a ninguna firma.'}</p></div>
            {nota && <div className="notice">{nota}</div>}
            <form onSubmit={unirse} style={{ display: 'contents' }}>
              <div className="field"><label htmlFor="bCodigo">¿Te invitaron? Código de la invitación</label>
                <input type="text" id="bCodigo" className="mono" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Pega el código del enlace del correo" /></div>
              <button className="btn block" disabled={ocupado || !codigo.trim()}>Unirme a la firma<Icono nombre="arrowRight" /></button>
            </form>
            {paso.firmas.length === 0 && (
              <form onSubmit={crearFirma} style={{ display: 'contents' }}>
                <div className="field"><label htmlFor="bFirma">¿Eres contador independiente o tienes una firma? Nombre de la firma</label>
                  <input type="text" id="bFirma" value={nombreFirma} onChange={(e) => setNombreFirma(e.target.value)} placeholder="Ortiz Contadores Asociados" /></div>
                <button className="btn primary block" disabled={ocupado || !nombreFirma.trim()}>Crear mi firma<Icono nombre="arrowRight" /></button>
              </form>)}
            {error && <div className="notice danger" role="alert">{error}</div>}
            {salir}
          </>
        )}

        {paso.tipo === 'empresa' && (
          <form onSubmit={crearEmpresa} style={{ display: 'contents' }}>
            <div><h2 id="tituloAcceso">Primera empresa</h2>
              <p className="login-lead">{paso.firma.nombre}: registra la primera empresa cliente. Puedes agregar más desde "Mis empresas".</p></div>
            <CamposEmpresa datos={empresa} cambiar={setEmpresa} />
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear empresa y entrar'}<Icono nombre="arrowRight" /></button>
            {salir}
          </form>
        )}
      </section>
    </MarcoAcceso>
  );
}
