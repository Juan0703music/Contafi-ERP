import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

export const metadata: Metadata = { title: 'Precios' };
// Los precios vienen de la misma tabla que aplica los límites de cada plan; se revisan cada hora.
export const revalidate = 3600;

interface Plan { codigo: string; nombre: string; usuarios_max: number; empresas_max: number; precio_mensual: string; precio_empresa_adicional: string }

async function planes(): Promise<Plan[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !clave) return null;
  try {
    const { data, error } = await createClient(url, clave, { auth: { persistSession: false } })
      .from('planes').select('codigo,nombre,usuarios_max,empresas_max,precio_mensual,precio_empresa_adicional').order('orden');
    return error ? null : (data as Plan[]);
  } catch {
    return null;
  }
}

const pesos = (v: string | number) => `$ ${Math.round(Number(v)).toLocaleString('es-CO')}`;

export default async function Precios() {
  const lista = (await planes())?.filter((p) => p.codigo !== 'prueba');
  const adicional = lista?.[0]?.precio_empresa_adicional;
  return (
    <main className="contenedor seccion">
      <h1>Precios</h1>
      <p className="entrada">Un precio por contador o por firma, no por empresa. Jarvis incluido en todos los planes. <b>Precios mensuales antes de IVA.</b></p>
      {lista?.length ? (
        <div className="rejilla planes">
          {lista.map((p, i) => (
            <article key={p.codigo} className={`tarjeta plan${i === 1 ? ' destacado' : ''}`}>
              <h2>{p.nombre}</h2>
              <p className="precio">{pesos(p.precio_mensual)}<span> /mes + IVA</span></p>
              <ul>
                <li>{p.usuarios_max} usuario{p.usuarios_max === 1 ? '' : 's'}</li>
                <li>Hasta {p.empresas_max} empresas</li>
                <li>Jarvis con IA local y voz</li>
                <li>Sincronización y respaldos en la nube</li>
              </ul>
            </article>
          ))}
        </div>
      ) : <div className="tarjeta"><p>Escríbenos para conocer los precios vigentes.</p></div>}
      <div className="tarjeta notas">
        <ul>
          <li><b>Prueba gratis de 30 días</b> con datos de demostración y una empresa real.</li>
          {adicional && Number(adicional) > 0 && <li>Empresa adicional: {pesos(adicional)} al mes + IVA.</li>}
          <li>Pago anual: 2 meses gratis.</li>
          <li>Precio de fundador: 50 % de descuento de por vida para los primeros 20 contadores, a cambio de retroalimentación.</li>
          <li>Si la suscripción vence, Contafi queda en modo consulta: ves y exportas todo, y lo que registres se guarda y se envía al renovar.</li>
        </ul>
      </div>
      <p><Link href="/descargar" className="boton primario">Empezar la prueba</Link></p>
    </main>
  );
}
