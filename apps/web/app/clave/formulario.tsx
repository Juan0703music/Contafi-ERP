'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createClient } from '@supabase/supabase-js';

type Estado = 'revisando' | 'listo' | 'invalido' | 'guardado';

/**
 * El enlace del correo trae la sesión de recuperación en el fragmento (#access_token=…&type=recovery):
 * supabase-js la lee al crearse y solo sirve para cambiar la contraseña. Nada de esto pasa por el servidor.
 */
export function NuevaClave() {
  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && clave ? createClient(url, clave, { auth: { detectSessionInUrl: true, persistSession: false, flowType: 'implicit' } }) : null;
  }, []);
  const [estado, setEstado] = useState<Estado>('revisando');
  const [motivo, setMotivo] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!sb) { setEstado('invalido'); setMotivo('El sitio no está configurado.'); return; }
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('error_description')) {
      setEstado('invalido');
      setMotivo(hash.get('error_code') === 'otp_expired' ? 'El enlace ya venció.' : hash.get('error_description')!);
      return;
    }
    const { data } = sb.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'PASSWORD_RECOVERY' || (evento === 'INITIAL_SESSION' && sesion)) setEstado('listo');
    });
    // Si no llega una sesión de recuperación, el enlace no sirve.
    const t = setTimeout(() => setEstado((e) => (e === 'revisando' ? 'invalido' : e)), 3000);
    return () => { data.subscription.unsubscribe(); clearTimeout(t); };
  }, [sb]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (clave !== clave2) return setError('Las contraseñas no coinciden.');
    setOcupado(true);
    const { error: err } = await sb!.auth.updateUser({ password: clave });
    setOcupado(false);
    if (err) return setError(/password/i.test(err.message) ? 'La contraseña es muy débil o es igual a la anterior.' : err.message);
    await sb!.auth.signOut();
    // Que el token no quede en el historial del navegador.
    history.replaceState(null, '', window.location.pathname);
    setEstado('guardado');
  }

  if (estado === 'revisando') return <div className="tarjeta"><p>Revisando el enlace…</p></div>;
  if (estado === 'invalido') {
    return <div className="tarjeta"><p>{motivo || 'El enlace no es válido o ya se usó.'} Pide uno nuevo desde Contafi con «¿Olvidaste tu contraseña?».</p></div>;
  }
  if (estado === 'guardado') return <div className="tarjeta"><p>Listo. Ya puedes ingresar en Contafi con tu nueva contraseña.</p></div>;
  return (
    <form className="tarjeta" onSubmit={guardar}>
      <p><label>Nueva contraseña<br /><input type="password" autoComplete="new-password" minLength={10} required value={clave} onChange={(e) => setClave(e.target.value)} /></label></p>
      <p><label>Repetir contraseña<br /><input type="password" autoComplete="new-password" required value={clave2} onChange={(e) => setClave2(e.target.value)} /></label></p>
      {error && <p role="alert">{error}</p>}
      <button disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar contraseña'}</button>
    </form>
  );
}
