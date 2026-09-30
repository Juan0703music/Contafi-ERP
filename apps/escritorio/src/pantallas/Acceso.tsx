import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Icono } from '../componentes/comunes.tsx';
import { alternarTema, alternarVidrio } from '../apariencia.ts';

type Paso =
  | { tipo: 'credenciales' }
  | { tipo: 'mfa-configurar'; factorId: string; qr: string; secreto: string }
  | { tipo: 'mfa-verificar'; factorId: string };

/**
 * Inicio de sesión. En la nube: correo y contraseña y, si el usuario administra una firma, MFA (TOTP)
 * obligatorio (la base de datos no le da permisos de administrador sin él). En demostración: un botón.
 */
export function Acceso({ supabase, alEntrar, alEntrarDemo }: {
  supabase: SupabaseClient | null;
  alEntrar: () => Promise<void>;
  alEntrarDemo: () => Promise<void>;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'credenciales' });
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    const { data: factores } = await sb.auth.mfa.listFactors();
    const totp = factores?.totp.find((f) => f.status === 'verified');
    if (totp) return setPaso({ tipo: 'mfa-verificar', factorId: totp.id });
    const { data, error: e3 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Contafi' });
    if (e3) throw new Error(e3.message);
    setPaso({ tipo: 'mfa-configurar', factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret });
  }); };

  const verificar = (e: FormEvent) => { e.preventDefault(); void trabajar(async () => {
    if (paso.tipo === 'credenciales') return;
    const { error: err } = await supabase!.auth.mfa.challengeAndVerify({ factorId: paso.factorId, code: codigo.trim() });
    if (err) throw new Error('El código no es válido o ya venció. Intente con el código actual de la aplicación.');
    await alEntrar();
  }); };

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
      <section className="login-card" aria-labelledby="tituloAcceso">
        {paso.tipo === 'credenciales' && (supabase ? (
          <form onSubmit={entrar} style={{ display: 'contents' }}>
            <div><h2 id="tituloAcceso">Ingresar</h2><p className="login-lead">Con tu correo y contraseña de Contafi.</p></div>
            <div className="field"><label htmlFor="correo">Correo</label><input id="correo" type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
            <div className="field"><label htmlFor="clave">Contraseña</label><input id="clave" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} /></div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado}>{ocupado ? 'Ingresando…' : 'Ingresar'}<Icono nombre="arrowRight" /></button>
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
        {paso.tipo !== 'credenciales' && (
          <form onSubmit={verificar} style={{ display: 'contents' }}>
            <div><h2 id="tituloAcceso">Verificación en dos pasos</h2>
              <p className="login-lead">{paso.tipo === 'mfa-configurar'
                ? 'Como administras una firma, debes activar la verificación en dos pasos. Escanea el código con Google Authenticator, Microsoft Authenticator o similar.'
                : 'Escribe el código de 6 dígitos de tu aplicación de autenticación.'}</p></div>
            {paso.tipo === 'mfa-configurar' && (
              <div style={{ textAlign: 'center' }}>
                <img src={paso.qr} alt="Código QR para la aplicación de autenticación" width={180} height={180} style={{ background: '#fff', borderRadius: 12, padding: 8 }} />
                <p className="hint">¿No puedes escanear? Clave: <span className="mono">{paso.secreto}</span></p>
              </div>
            )}
            <div className="field"><label htmlFor="codigo">Código</label>
              <input id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value)} /></div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="btn primary block" disabled={ocupado}>{ocupado ? 'Verificando…' : 'Verificar'}<Icono nombre="check" /></button>
          </form>
        )}
      </section>
      <div className="login-foot">Contafi · La responsabilidad profesional sobre la contabilidad es del contador; Contafi es una herramienta.</div>
    </div>
  );
}
