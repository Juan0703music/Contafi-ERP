import { useCallback, useEffect, useMemo, useState } from 'react';
import { migrar, empresasLocales, guardarEmpresas, cambiarPeriodoLocal, type BaseLocal } from '@contafi/local';
import { ProveedorApp, useApp, type Sesion } from './estado.tsx';
import { Marco } from './componentes/Marco.tsx';
import { Acceso } from './pantallas/Acceso.tsx';
import { Panel } from './pantallas/Panel.tsx';
import { Comprobantes, NuevoComprobante } from './pantallas/Comprobantes.tsx';
import { Cuentas } from './pantallas/Cuentas.tsx';
import { Balance } from './pantallas/Balance.tsx';
import { Terceros } from './pantallas/Terceros.tsx';
import { Sincronizacion } from './pantallas/Sincronizacion.tsx';
import { Libros } from './pantallas/Libros.tsx';
import { ImportarDian } from './pantallas/ImportarDian.tsx';
import { Cierres } from './pantallas/Cierres.tsx';
import { Impuestos } from './pantallas/Impuestos.tsx';
import { Bancos } from './pantallas/Bancos.tsx';
import { Empresas } from './pantallas/Empresas.tsx';
import { Jarvis } from './pantallas/Jarvis.tsx';
import { Ventas } from './pantallas/Ventas.tsx';
import { SaldosIniciales } from './pantallas/SaldosIniciales.tsx';
import { Estados } from './pantallas/Estados.tsx';
import { abrirBaseNavegador } from './datos/base-navegador.ts';
import { abrirBaseTauri, cerrarBaseTauri, enTauri } from './datos/base-tauri.ts';
import { sembrarDemo, transporteDemo } from './datos/demo.ts';
import { configuracionNube, dispositivoLocal, empresasDelUsuario, transporteNube } from './datos/nube.ts';

const VERSION_APP = '0.3.0';

/** Abre la base local (SQLCipher en la app; SQLite en memoria en el navegador) y aplica migraciones. */
async function abrirBase(): Promise<{ base: BaseLocal; aviso: string | null }> {
  if (enTauri()) {
    const { base, apertura } = await abrirBaseTauri();
    await migrar(base);
    return { base, aviso: apertura.estado === 'restaurada' ? `La base local estaba dañada y se restauró el respaldo ${apertura.respaldo}. Se sincronizará con la nube.` : null };
  }
  const base = await abrirBaseNavegador();
  await migrar(base);
  return { base, aviso: null };
}

function Pantallas() {
  const { ruta } = useApp();
  const [nuevo, setNuevo] = useState(false);
  const abrirNuevo = useCallback(() => setNuevo(true), []);
  return (
    <Marco>
      {ruta === 'empresas' && <Empresas />}
      {ruta === 'panel' && <Panel nuevoComprobante={abrirNuevo} />}
      {ruta === 'jarvis' && <Jarvis />}
      {ruta === 'ventas' && <Ventas />}
      {ruta === 'comprobantes' && <Comprobantes nuevoComprobante={abrirNuevo} />}
      {ruta === 'importar' && <ImportarDian />}
      {ruta === 'bancos' && <Bancos />}
      {ruta === 'cuentas' && <Cuentas />}
      {ruta === 'cierres' && <Cierres />}
      {ruta === 'saldos' && <SaldosIniciales />}
      {ruta === 'balance' && <Balance />}
      {ruta === 'libros' && <Libros />}
      {ruta === 'estados' && <Estados />}
      {ruta === 'terceros' && <Terceros />}
      {ruta === 'impuestos' && <Impuestos />}
      {ruta === 'sincronizacion' && <Sincronizacion />}
      {nuevo && <NuevoComprobante alCerrar={() => setNuevo(false)} />}
    </Marco>
  );
}

export function App() {
  const nube = useMemo(() => configuracionNube(), []);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const entrarDemo = useCallback(async () => {
    const { base, aviso: a } = await abrirBase();
    if ((await empresasLocales(base)).length === 0) await sembrarDemo(base);
    setSesion({
      base, modo: 'demo', usuario: { nombre: 'Invitado', correo: 'Demostración' }, empresas: await empresasLocales(base),
      transporte: transporteDemo(base), dispositivo: dispositivoLocal(VERSION_APP), avisoInicial: a,
      cerrarSesion: async () => { await cerrarBaseTauri(); setSesion(null); },
      cambiarPeriodo: (empresa, anio, mes, estado) => cambiarPeriodoLocal(base, empresa, anio, mes, estado),
    });
  }, []);

  const entrarNube = useCallback(async () => {
    const { supabase, api } = nube!;
    const { base, aviso: a } = await abrirBase();
    const empresas = await empresasDelUsuario(supabase);
    if (empresas.length === 0) {
      setAviso('Tu usuario todavía no tiene empresas. Pide a un administrador de tu firma que te invite.');
      await supabase.auth.signOut();
      return;
    }
    await guardarEmpresas(base, empresas);
    const { data } = await supabase.auth.getUser();
    setSesion({
      base, modo: 'nube', empresas, transporte: transporteNube(supabase, api), dispositivo: dispositivoLocal(VERSION_APP), avisoInicial: a,
      usuario: { nombre: (data.user?.user_metadata?.['nombre'] as string | undefined) ?? data.user?.email ?? 'Usuario', correo: data.user?.email ?? '' },
      cerrarSesion: async () => { await supabase.auth.signOut(); await cerrarBaseTauri(); setSesion(null); },
      cambiarPeriodo: async (empresa, anio, mes, estado) => {
        const { error } = await supabase.rpc('cambiar_estado_periodo', { p_empresa: empresa, p_anio: anio, p_mes: mes, p_estado: estado });
        if (error) throw new Error(error.message.includes('SIN_PERMISO') ? 'Tu rol no tiene permiso para cerrar o reabrir períodos.' : error.message.includes('fetch') ? 'Cerrar un período requiere conexión a internet.' : error.message);
      },
    });
  }, [nube]);

  // Enlace directo a la demostración (?demo), útil para mostrarla a los pilotos.
  useEffect(() => {
    if (!nube && !enTauri() && new URLSearchParams(location.search).has('demo')) void entrarDemo();
  }, [nube, entrarDemo]);

  if (!sesion) {
    return (
      <>
        {aviso && <div className="notice warn" style={{ position: 'fixed', top: 16, left: 16, right: 16, zIndex: 10 }}>{aviso}</div>}
        <Acceso supabase={nube?.supabase ?? null} alEntrar={entrarNube} alEntrarDemo={entrarDemo} />
      </>
    );
  }
  return <ProveedorApp sesion={sesion}><Pantallas /></ProveedorApp>;
}
