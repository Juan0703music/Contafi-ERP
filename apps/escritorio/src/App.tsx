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
import { Inventario } from './pantallas/Inventario.tsx';
import { SaldosIniciales } from './pantallas/SaldosIniciales.tsx';
import { Estados } from './pantallas/Estados.tsx';
import { Equipo } from './pantallas/Equipo.tsx';
import { Bienvenida } from './pantallas/Bienvenida.tsx';
import { DobleCorrida } from './pantallas/DobleCorrida.tsx';
import { abrirBaseNavegador } from './datos/base-navegador.ts';
import { abrirBaseTauri, cerrarBaseTauri, enTauri } from './datos/base-tauri.ts';
import { EMPRESA_DEMO, sembrarDemo, transporteDemo } from './datos/demo.ts';
import { configuracionNube, dispositivoLocal, empresasDelUsuario, transporteNube } from './datos/nube.ts';
import { servicioFirmaDemo, servicioFirmaNube, type FirmaUsuario } from './datos/firma.ts';
import { impuestosLocales, impuestosNube } from './datos/impuestos.ts';

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
      {ruta === 'inventario' && <Inventario />}
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
      {ruta === 'equipo' && <Equipo />}
      {ruta === 'comparar' && <DobleCorrida />}
      {nuevo && <NuevoComprobante alCerrar={() => setNuevo(false)} />}
    </Marco>
  );
}

export function App() {
  const nube = useMemo(() => configuracionNube(), []);
  const servicioNube = useMemo(() => (nube ? servicioFirmaNube(nube.supabase, nube.api) : null), [nube]);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  /** Usuario de la nube sin empresas: asistente para crear su firma o unirse a una. */
  const [bienvenida, setBienvenida] = useState(false);

  const entrarDemo = useCallback(async () => {
    const { base, aviso: a } = await abrirBase();
    if ((await empresasLocales(base)).length === 0) await sembrarDemo(base);
    const empresas = await empresasLocales(base);
    const firma: FirmaUsuario = { id: EMPRESA_DEMO.firma_id, nombre: 'Firma de demostración', rol: 'propietario' };
    setSesion({
      base, modo: 'demo', usuario: { nombre: 'Invitado', correo: 'Demostración' }, empresas,
      transporte: transporteDemo(base), dispositivo: dispositivoLocal(VERSION_APP), avisoInicial: a,
      cerrarSesion: async () => { await cerrarBaseTauri(); setSesion(null); },
      cambiarPeriodo: (empresa, anio, mes, estado) => cambiarPeriodoLocal(base, empresa, anio, mes, estado),
      firma: servicioFirmaDemo(base, firma, empresas), firmas: [firma], impuestos: impuestosLocales(base),
      recargarEmpresas: async () => { const e = await empresasLocales(base); setSesion((s) => s && { ...s, empresas: e }); },
    });
  }, []);

  const entrarNube = useCallback(async (): Promise<boolean> => {
    const { supabase, api } = nube!;
    const empresas = await empresasDelUsuario(supabase);
    if (empresas.length === 0) {
      setBienvenida(true);
      return false;
    }
    const { base, aviso: a } = await abrirBase();
    await guardarEmpresas(base, empresas);
    const firmas = await servicioNube!.misFirmas().catch(() => [] as FirmaUsuario[]);
    const { data } = await supabase.auth.getUser();
    setSesion({
      base, modo: 'nube', empresas, transporte: transporteNube(supabase, api), dispositivo: dispositivoLocal(VERSION_APP), avisoInicial: a,
      usuario: { nombre: (data.user?.user_metadata?.['nombre'] as string | undefined) ?? data.user?.email ?? 'Usuario', correo: data.user?.email ?? '' },
      cerrarSesion: async () => { await supabase.auth.signOut(); await cerrarBaseTauri(); setSesion(null); },
      firma: servicioNube!, firmas, impuestos: impuestosNube(supabase, base),
      recargarEmpresas: async () => {
        const e = await empresasDelUsuario(supabase);
        await guardarEmpresas(base, e);
        setSesion((s) => s && { ...s, empresas: e });
      },
      cambiarPeriodo: async (empresa, anio, mes, estado) => {
        const { error } = await supabase.rpc('cambiar_estado_periodo', { p_empresa: empresa, p_anio: anio, p_mes: mes, p_estado: estado });
        if (error) throw new Error(error.message.includes('SIN_PERMISO') ? 'Tu rol no tiene permiso para cerrar o reabrir períodos.' : error.message.includes('fetch') ? 'Cerrar un período requiere conexión a internet.' : error.message);
      },
    });
    setBienvenida(false);
    return true;
  }, [nube, servicioNube]);

  // Enlace directo a la demostración (?demo), útil para mostrarla a los pilotos.
  useEffect(() => {
    if (!nube && !enTauri() && new URLSearchParams(location.search).has('demo')) void entrarDemo();
  }, [nube, entrarDemo]);

  if (!sesion && bienvenida && nube) {
    return <Bienvenida supabase={nube.supabase} servicio={servicioNube!} alListo={entrarNube}
      alSalir={async () => { await nube.supabase.auth.signOut(); setBienvenida(false); }} />;
  }
  if (!sesion) {
    return <Acceso supabase={nube?.supabase ?? null} urlSitio={nube?.api ?? null} alEntrar={async () => { await entrarNube(); }} alEntrarDemo={entrarDemo} />;
  }
  return <ProveedorApp sesion={sesion}><Pantallas /></ProveedorApp>;
}
