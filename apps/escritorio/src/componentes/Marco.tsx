import { useState, type ReactNode } from 'react';
import { useApp, useDatos, type Ruta } from '../estado.tsx';
import { Icono, haceCuanto } from './comunes.tsx';
import { alternarTema, alternarVidrio } from '../apariencia.ts';
import { balanceGeneral } from '@contafi/motor';
import { comprobantesParaReportes, hoyContable } from '@contafi/local';

const NAV: { grupo: string; items: { ruta: Ruta; etiqueta: string; icono: string }[] }[] = [
  { grupo: 'General', items: [
    { ruta: 'empresas', etiqueta: 'Mis empresas', icono: 'building' },
    { ruta: 'panel', etiqueta: 'Panel', icono: 'dashboard' },
  ] },
  { grupo: 'Contabilidad', items: [
    { ruta: 'comprobantes', etiqueta: 'Comprobantes', icono: 'file' },
    { ruta: 'importar', etiqueta: 'Importar DIAN', icono: 'receipt' },
    { ruta: 'bancos', etiqueta: 'Conciliación bancaria', icono: 'bank' },
    { ruta: 'cuentas', etiqueta: 'Plan de cuentas', icono: 'tree' },
    { ruta: 'balance', etiqueta: 'Balance de prueba', icono: 'scale' },
    { ruta: 'cierres', etiqueta: 'Períodos y cierres', icono: 'lock' },
    { ruta: 'saldos', etiqueta: 'Saldos iniciales', icono: 'calendar' },
  ] },
  { grupo: 'Reportes', items: [
    { ruta: 'libros', etiqueta: 'Libros', icono: 'bookOpen' },
    { ruta: 'estados', etiqueta: 'Estados financieros', icono: 'barChart' },
  ] },
  { grupo: 'Maestros', items: [
    { ruta: 'terceros', etiqueta: 'Terceros', icono: 'users' },
    { ruta: 'impuestos', etiqueta: 'Impuestos y retenciones', icono: 'sliders' },
  ] },
  { grupo: 'Sistema', items: [{ ruta: 'sincronizacion', etiqueta: 'Sincronización', icono: 'shield' }] },
];

function ChipSincronizacion() {
  const { sync, sincronizarAhora, modo, ir } = useApp();
  const e = sync.estado;
  let texto = 'Sincronizado';
  let clase = 'posted';
  if (sync.enCurso) { texto = 'Sincronizando…'; clase = 'open'; }
  else if (sync.ultimo?.error) { texto = 'Sin conexión'; clase = 'draft'; }
  else if (e && (e.rechazados || e.tercerosConError)) { texto = `${e.rechazados + e.tercerosConError} con error`; clase = 'annulled'; }
  else if (e?.pendientes) { texto = `${e.pendientes} pendiente(s)`; clase = 'draft'; }
  const titulo = `${modo === 'demo' ? 'Modo demostración (servidor simulado). ' : ''}Última sincronización: ${haceCuanto(e?.ultimaSincronizacion ?? null)}. Clic para sincronizar.`;
  return (
    <button className="chip" title={titulo} onClick={() => { void sincronizarAhora(); ir('sincronizacion'); }}>
      <span className={`pill ${clase}`}>{texto}</span>
    </button>
  );
}

export function Marco({ children }: { children: ReactNode }) {
  const { ruta, ir, empresa, empresas, cambiarEmpresa, usuario, cerrarSesion, base, version, sync, modo } = useApp();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { datos: cuadra } = useDatos(async () => {
    const cs = await comprobantesParaReportes(base, empresa.id, { incluirPendientes: true });
    return balanceGeneral(cs, hoyContable().fecha).cuadra;
  }, [base, empresa.id, version]);
  const pendientes = sync.estado?.pendientes ?? 0;

  return (
    <>
      <aside className={`sidebar${menuAbierto ? ' open' : ''}`} aria-label="Menú principal">
        <div className="brand">
          <div className="logo"><Icono nombre="ledger" /></div>
          <div><div className="brand-name">Contafi</div><div className="brand-sub">{modo === 'demo' ? 'Modo demostración' : 'Núcleo financiero-contable'}</div></div>
        </div>
        <nav>
          {NAV.map((g) => (
            <div className="nav-group" key={g.grupo}>
              {g.grupo !== 'General' && <div className="nav-group-label">{g.grupo}</div>}
              {g.items.map((it) => (
                <button key={it.ruta} type="button" className={`nav-item${ruta === it.ruta ? ' active' : ''}`}
                  aria-current={ruta === it.ruta ? 'page' : undefined} onClick={() => { ir(it.ruta); setMenuAbierto(false); }}>
                  <Icono nombre={it.icono} /><span className="lbl">{it.etiqueta}</span>
                  {it.ruta === 'sincronizacion' && pendientes > 0 && <span className="nav-badge warn" title={`${pendientes} por sincronizar`}>{pendientes}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {cuadra !== undefined && (
          <div className={`side-foot${cuadra ? '' : ' bad'}`}>
            <span className="badge-ic"><Icono nombre={cuadra ? 'circleCheck' : 'alert'} /></span>
            <div><b>{cuadra ? 'Ecuación contable cuadra' : 'La ecuación no cuadra'}</b><span>Activo = Pasivo + Patrimonio</span></div>
          </div>
        )}
        <div className="side-actions">
          <button className="btn icon" title="Reducir transparencia" aria-label="Reducir transparencia" onClick={alternarVidrio}><Icono nombre="droplet" /></button>
          <button className="btn icon" title="Cambiar tema" aria-label="Cambiar tema" onClick={alternarTema}><Icono nombre="moon" /></button>
          <button className="btn" onClick={() => void cerrarSesion()}><Icono nombre="logout" />Cerrar sesión</button>
        </div>
      </aside>
      <div className={`side-scrim${menuAbierto ? ' show' : ''}`} onClick={() => setMenuAbierto(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon hamburger" aria-label="Abrir menú" onClick={() => setMenuAbierto(true)}><Icono nombre="menu" /></button>
          <label className="chip company-chip" title="Empresa activa">
            <span className="chip-ic"><Icono nombre="building" /></span>
            <span className="chip-col">
              <select aria-label="Empresa" value={empresa.id} onChange={(e) => cambiarEmpresa(e.target.value)}>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.razon_social}</option>)}
              </select>
              <span className="sub">NIT {empresa.nit}{empresa.dv != null ? `-${empresa.dv}` : ''}</span>
            </span>
          </label>
          <div className="spacer" />
          <ChipSincronizacion />
          <button className="btn ghost icon hide-sm" title="Reducir transparencia" aria-label="Reducir transparencia" onClick={alternarVidrio}><Icono nombre="droplet" /></button>
          <button className="btn ghost icon hide-sm" title="Cambiar tema" aria-label="Cambiar tema" onClick={alternarTema}><Icono nombre="moon" /></button>
          <span className="chip role-switch" title={usuario.correo}>
            <span className="avatar">{usuario.nombre.slice(0, 1).toUpperCase()}</span>
            <span className="chip-col"><span className="who">{usuario.nombre}</span><span className="role">{usuario.correo}</span></span>
          </span>
        </header>
        <div className="content">{children}</div>
        <footer className="appfoot">Contafi · {modo === 'demo' ? 'Datos de demostración en este equipo; no se envían a ningún servidor.' : 'Los datos se guardan cifrados en este equipo y se sincronizan con la nube.'}</footer>
      </div>
    </>
  );
}
