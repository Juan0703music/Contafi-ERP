import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Icono } from '../componentes/comunes.tsx';
import { alternarTema, alternarVidrio } from '../apariencia.ts';

type Paso = { tipo: 'credenciales' } | { tipo: 'registro' } | { tipo: 'mfa' };

/**
 * Inicio de sesión. En la nube: correo y contraseña y, si el usuario administra una firma, MFA (TOTP)
 * obligatorio (la base de datos no le da permisos de administrador sin él). En demostración: un botón.
 */
export function Acceso({ supabase, urlSitio, alEntrar, alEntrarDemo }: {
  supabase: SupabaseClient | null;
  /** Sitio web (apps/web): ahí se crea la nueva contraseña con el enlace del correo. */
  urlSitio: string | null;
  alEntrar: () => Promise<void>;
  alEntrarDemo: () => Promise<void>;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'credenciales' });
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function trabajar(fn: () => Promise<void>) {
    setError(null);
    setOcupado(true);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }

  const entrar = (e: FormEvent) => { e.preventDefault(); void trabajar(async () => {
    const sb = supabase!;
    const { error: err } = await sb.auth.signInWithPassword({ email: correo.trim(), password: clave });
    if (err) throw new Error(err.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : err.message);
    const { data: requiere, error: e2 } = await sb.rpc('requiere_mfa');
    if (e2) throw new Error(e2.message);
    if (!requiere) return alEntrar();
    setPaso({ tipo: 'mfa' });
  }); };

  const recuperar = () => void trabajar(async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) throw new Error('Escribe tu correo y vuelve a intentarlo.');
    const { error: err } = await supabase!.auth.resetPasswordForEmail(correo.trim(), { redirectTo: `${urlSitio}/clave` });
    if (err) throw new Error(/rate|seconds/i.test(err.message) ? 'Espera un minuto antes de pedir otro enlace.' : err.message);
    // El mismo mensaje exista o no la cuenta: no revela qué correos están registrados.
    setNota(`Si ${correo.trim()} tiene cuenta en Contafi, te llegará un enlace para crear una nueva contraseña.`);
  });

  const registrar = (e: FormEvent) => { e.preventDefault(); void trabajar(async () => {
    if (clave.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
    if (clave !== clave2) throw new Error('Las contraseñas no coinciden.');
    const { data, error: err } = await supabase!.auth.signUp({ email: correo.trim(), password: clave, options: { data: { nombre: nombre.trim() } } });
    if (err) throw new Error(/password/i.test(err.message) ? 'La contraseña es muy débil: use letras, números y símbolos.' : err.message);
    if (data.session) return alEntrar();
    // Con confirmación de correo activa (lo normal en producción), primero hay que abrir el enlace.
    setNota(`Te enviamos un correo a ${correo.trim()} para confirmar la cuenta. Ábrelo y después ingresa aquí.`);
    setClave(''); setClave2('');
    setPaso({ tipo: 'credenciales' });
  }); };

  return (
    <MarcoAcceso>
      <section className="login-card" aria-labelledby="tituloAcceso">
        {paso.tipo === 'credenciales' && (supabase ? (
          <form onSubmit={entrar} style={{ display: 'contents' }}>
            <div><h2 id="tituloAcceso">Ingresar</h2><p className="login-lead">Con tu correo y contraseña de Contafi.</p></div>
            {nota && <div className="notice">{nota}</div>}
            <div className="field"><label htmlFor="correo">Correo</label><input id="correo" type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
            <div className="field"><label htmlFor="clave">Contraseña</label><input id="clave" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} /></div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado}>{ocupado ? 'Ingresando…' : 'Ingresar'}<Icono nombre="arrowRight" /></button>
            <div className="btn-row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn ghost" disabled={ocupado} onClick={recuperar}>¿Olvidaste tu contraseña?</button>
              <button type="button" className="btn ghost" onClick={() => { setError(null); setNota(null); setPaso({ tipo: 'registro' }); }}>Crear una cuenta</button>
            </div>
          </form>
        ) : (
          <>
            <div><h2 id="tituloAcceso">Demostración</h2>
              <p className="login-lead">Esta copia no está conectada a la nube. Puedes probar Contafi con datos de ejemplo: todo queda solo en este equipo.</p></div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado} onClick={() => void trabajar(alEntrarDemo)}>{ocupado ? 'Preparando…' : 'Entrar a la demostración'}<Icono nombre="arrowRight" /></button>
            <div className="help-note"><Icono nombre="info" /><span>Para usar tus empresas reales, configura la conexión (ver <b>.env.example</b>).</span></div>
          </>
        ))}
        {paso.tipo === 'registro' && (
          <form onSubmit={registrar} style={{ display: 'contents' }}>
            <div><h2 id="tituloAcceso">Crear cuenta</h2><p className="login-lead">Tu usuario personal. Después creas tu firma o entras con la invitación de tu equipo.</p></div>
            <div className="field"><label htmlFor="rNombre">Nombre</label><input id="rNombre" type="text" autoComplete="name" required value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
            <div className="field"><label htmlFor="rCorreo">Correo</label><input id="rCorreo" type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
            <div className="grid2">
              <div className="field"><label htmlFor="rClave">Contraseña</label><input id="rClave" type="password" autoComplete="new-password" required minLength={10} value={clave} onChange={(e) => setClave(e.target.value)} /></div>
              <div className="field"><label htmlFor="rClave2">Repetir contraseña</label><input id="rClave2" type="password" autoComplete="new-password" required value={clave2} onChange={(e) => setClave2(e.target.value)} /></div>
            </div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear cuenta'}<Icono nombre="arrowRight" /></button>
            <button type="button" className="btn ghost block" onClick={() => { setError(null); setPaso({ tipo: 'credenciales' }); }}>Ya tengo cuenta</button>
          </form>
        )}
        {paso.tipo === 'mfa' && <PasoMfa supabase={supabase!} alVerificar={alEntrar} />}
      </section>
    </MarcoAcceso>
  );
}

/** Pantalla de acceso: presentación a la izquierda y la tarjeta (`children`) a la derecha. */
export function MarcoAcceso({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login-tools">
        <button className="btn ghost icon" aria-label="Reducir transparencia" onClick={alternarVidrio}><Icono nombre="droplet" /></button>
        <button className="btn ghost icon" aria-label="Cambiar tema" onClick={alternarTema}><Icono nombre="moon" /></button>
      </div>
      <section className="login-hero">
        <div className="brand"><div className="logo"><Icono nombre="ledger" /></div><span className="brand-name">Contafi</span></div>
        <div>
          <h1>Todas tus empresas, aunque se vaya el internet</h1>
          <p>Contabilidad multi-empresa para contadores en Colombia.</p>
        </div>
        <div className="feature-chips">
          <span className="feature-chip"><Icono nombre="scale" />Partida doble validada</span>
          <span className="feature-chip"><Icono nombre="shield" />Datos cifrados en tu PC</span>
          <span className="feature-chip"><Icono nombre="building" />Multi-empresa</span>
          <span className="feature-chip"><Icono nombre="bank" />Funciona sin conexión</span>
        </div>
      </section>
      {children}
      <div className="login-foot">Contafi · La responsabilidad profesional sobre la contabilidad es del contador; Contafi es una herramienta.</div>
    </div>
  );
}

/**
 * Verificación en dos pasos (TOTP), obligatoria para administradores de una firma: si el usuario aún no
 * la tiene, la configura con un código QR; si ya la tiene, pide el código. Al terminar, la sesión es aal2.
 */
export function PasoMfa({ supabase, alVerificar, motivo }: { supabase: SupabaseClient; alVerificar: () => Promise<void>; motivo?: string }) {
  const [estado, setEstado] = useState<{ factorId: string; qr?: string; secreto?: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { data: factores } = await supabase.auth.mfa.listFactors();
      const totp = factores?.totp.find((f) => f.status === 'verified');
      if (totp) { if (vivo) setEstado({ factorId: totp.id }); return; }
      // Un intento anterior que no se terminó deja un factor sin verificar; Supabase no admite dos con el
      // mismo nombre, así que se quitan antes de crear el nuevo.
      for (const f of factores?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Contafi' });
      if (!vivo) return;
      if (err) setError(err.message);
      else setEstado({ factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret });
    })();
    return () => { vivo = false; };
  }, [supabase]);

  const verificar = (e: FormEvent) => {
    e.preventDefault();
    if (!estado) return;
    setError(null);
    setOcupado(true);
    void (async () => {
      try {
        const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: estado.factorId, code: codigo.trim() });
        if (err) throw new Error('El código no es válido o ya venció. Intente con el código actual de la aplicación.');
        await alVerificar();
      } catch (x) {
        setError((x as Error).message);
      } finally {
        setOcupado(false);
      }
    })();
  };

  return (
    <form onSubmit={verificar} style={{ display: 'contents' }}>
      <div><h2 id="tituloAcceso">Verificación en dos pasos</h2>
        <p className="login-lead">{estado?.qr
          ? (motivo ?? 'Como administras una firma, debes activar la verificación en dos pasos.') + ' Escanea el código con Google Authenticator, Microsoft Authenticator o similar.'
          : 'Escribe el código de 6 dígitos de tu aplicación de autenticación.'}</p></div>
      {estado?.qr && (
        <div style={{ textAlign: 'center' }}>
          <img src={estado.qr} alt="Código QR para la aplicación de autenticación" width={180} height={180} style={{ background: '#fff', borderRadius: 12, padding: 8 }} />
          <p className="hint">¿No puedes escanear? Clave: <span className="mono">{estado.secreto}</span></p>
        </div>
      )}
      <div className="field"><label htmlFor="codigo">Código</label>
        <input type="text" id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value)} /></div>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <button className="btn primary block" disabled={ocupado || !estado}>{ocupado ? 'Verificando…' : 'Verificar'}<Icono nombre="check" /></button>
    </form>
  );
}
