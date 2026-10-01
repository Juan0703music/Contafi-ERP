import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  estadoSincronizacion, sincronizar,
  type BaseLocal, type EmpresaLocal, type EstadoSincronizacion, type ResumenSincronizacion, type Transporte,
} from '@contafi/local';

export type Ruta = 'panel' | 'jarvis' | 'ventas' | 'comprobantes' | 'importar' | 'cierres' | 'saldos' | 'impuestos' | 'bancos' | 'empresas' | 'cuentas' | 'balance' | 'libros' | 'estados' | 'terceros' | 'sincronizacion';

export interface Sesion {
  base: BaseLocal;
  modo: 'demo' | 'nube';
  usuario: { nombre: string; correo: string };
  empresas: EmpresaLocal[];
  transporte: Transporte;
  dispositivo: { id: string; nombre: string; version_app: string };
  cerrarSesion: () => Promise<void>;
  /** Cierra o reabre un mes. En la nube lo hace el servidor (exige permiso de cierres y conexión). */
  cambiarPeriodo: (empresa: string, anio: number, mes: number, estado: 'abierto' | 'cerrado') => Promise<void>;
  /** Mensaje de la apertura de la base (p. ej. "se restauró el respaldo"). */
  avisoInicial: string | null;
}

interface Aviso { id: number; texto: string; tipo: 'ok' | 'danger' | '' }

interface ValorContexto extends Sesion {
  empresa: EmpresaLocal;
  cambiarEmpresa: (id: string) => void;
  ruta: Ruta;
  ir: (r: Ruta) => void;
  /** Cambia cada vez que los datos locales cambian: las pantallas lo usan para recargar. */
  version: number;
  refrescar: () => void;
  sync: { estado: EstadoSincronizacion | null; enCurso: boolean; ultimo: ResumenSincronizacion | null };
  sincronizarAhora: () => Promise<void>;
  avisar: (texto: string, tipo?: Aviso['tipo']) => void;
}

const Contexto = createContext<ValorContexto | null>(null);

export function useApp(): ValorContexto {
  const v = useContext(Contexto);
  if (!v) throw new Error('useApp fuera de ProveedorApp');
  return v;
}

/** Cada cuánto se sincroniza en segundo plano (además de al abrir, al volver la red y tras guardar). */
const INTERVALO_SYNC_MS = 60_000;

export function ProveedorApp({ sesion, children }: { sesion: Sesion; children: ReactNode }) {
  const [empresaId, setEmpresaId] = useState(sesion.empresas[0]!.id);
  const [ruta, setRuta] = useState<Ruta>(() => (new URLSearchParams(location.search).get('ruta') as Ruta | null) ?? 'panel');
  const [version, setVersion] = useState(0);
  const [sync, setSync] = useState<ValorContexto['sync']>({ estado: null, enCurso: false, ultimo: null });
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const enCurso = useRef(false);
  const empresa = sesion.empresas.find((e) => e.id === empresaId) ?? sesion.empresas[0]!;

  const avisar = useCallback((texto: string, tipo: Aviso['tipo'] = '') => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4200);
  }, []);

  const refrescar = useCallback(() => setVersion((v) => v + 1), []);

  const sincronizarAhora = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setSync((s) => ({ ...s, enCurso: true }));
    try {
      const r = await sincronizar(sesion.base, sesion.transporte, { empresa: empresa.id, dispositivo: sesion.dispositivo });
      const estado = await estadoSincronizacion(sesion.base, empresa.id);
      setSync({ estado, enCurso: false, ultimo: r });
      if (r.contabilizados) avisar(`${r.contabilizados} comprobante(s) recibieron su número oficial.`, 'ok');
      if (r.rechazados) avisar(`${r.rechazados} comprobante(s) fueron rechazados. Revíselos en Sincronización.`, 'danger');
      if (r.enviados || r.recibidos || r.tercerosRegistrados) refrescar();
    } catch (e) {
      setSync((s) => ({ ...s, enCurso: false }));
      avisar(`Error en la base local: ${(e as Error).message}`, 'danger');
    } finally {
      enCurso.current = false;
    }
  }, [sesion, empresa.id, avisar, refrescar]);

  // Estado de sincronización al cambiar de empresa o de datos
  useEffect(() => {
    let vivo = true;
    estadoSincronizacion(sesion.base, empresa.id).then((estado) => { if (vivo) setSync((s) => ({ ...s, estado })); });
    return () => { vivo = false; };
  }, [sesion.base, empresa.id, version]);

  // Sincronización automática: al abrir, cada minuto y cuando vuelve la red
  useEffect(() => {
    void sincronizarAhora();
    const t = setInterval(() => void sincronizarAhora(), INTERVALO_SYNC_MS);
    const enLinea = () => void sincronizarAhora();
    window.addEventListener('online', enLinea);
    return () => { clearInterval(t); window.removeEventListener('online', enLinea); };
  }, [sincronizarAhora]);

  useEffect(() => { if (sesion.avisoInicial) avisar(sesion.avisoInicial, 'danger'); }, [sesion.avisoInicial, avisar]);

  const valor: ValorContexto = {
    ...sesion, empresa, cambiarEmpresa: setEmpresaId, ruta, ir: setRuta, version, refrescar, sync, sincronizarAhora, avisar,
  };
  const host = document.getElementById('toastHost');
  return (
    <Contexto.Provider value={valor}>
      {children}
      {host && createPortal(avisos.map((a) => <div key={a.id} className={`toast ${a.tipo}`}>{a.texto}</div>), host)}
    </Contexto.Provider>
  );
}

/** Carga datos asíncronos que dependen de la versión de los datos locales. */
export function useDatos<T>(cargar: () => Promise<T>, deps: unknown[]): { datos: T | undefined; error: Error | null } {
  const [datos, setDatos] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let vivo = true;
    cargar().then((d) => { if (vivo) { setDatos(d); setError(null); } }, (e: Error) => { if (vivo) setError(e); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { datos, error };
}
