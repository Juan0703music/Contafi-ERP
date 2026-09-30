'use client';

import { useEffect, useState } from 'react';

/** Lee el token del fragmento (#token=...), que nunca llega al servidor. */
export function CodigoInvitacion() {
  const [token, setToken] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(t && /^[0-9a-f]{64}$/.test(t) ? t : '');
  }, []);

  if (token === null) return null;
  if (token === '') {
    return <div className="tarjeta"><p>El enlace no trae un código válido. Pide a quien te invitó que te envíe una nueva invitación.</p></div>;
  }
  return (
    <div className="tarjeta">
      <code>{token}</code>
      <p>
        <button onClick={async () => { await navigator.clipboard.writeText(token); setCopiado(true); }}>
          {copiado ? 'Copiado' : 'Copiar código'}
        </button>
      </p>
    </div>
  );
}
