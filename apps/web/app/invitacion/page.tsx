import type { Metadata } from 'next';
import { CodigoInvitacion } from './codigo.tsx';

export const metadata: Metadata = { title: 'Invitación — Contafi', robots: { index: false } };

export default function Invitacion() {
  return (
    <main>
      <h1>Te invitaron a Contafi</h1>
      <p>Abre Contafi en tu computador, inicia sesión con el correo al que llegó la invitación y elige
        <strong> «Aceptar invitación»</strong>. Pega este código:</p>
      <CodigoInvitacion />
      <p>El código vence en 7 días y solo sirve una vez.</p>
    </main>
  );
}
