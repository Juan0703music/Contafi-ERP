import { useState } from 'react';
import type { EmpresaLocal } from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio } from '../componentes/comunes.tsx';
import { NOMBRE_ROL, ROLES_EMPRESA, esAdministrador, type AccesoEmpresa, type Miembro, type RolEmpresa, type RolFirma } from '../datos/firma.ts';

const NOMBRE_ROL_FIRMA: Record<RolFirma, string> = { propietario: 'Propietario', administrador: 'Administrador', miembro: 'Miembro' };
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

/** Equipo de la firma: quién trabaja en qué empresa y con qué rol (sección 11.1). Solo administradores. */
export function Equipo() {
  const { firma, firmas, empresa, empresas, avisar, modo } = useApp();
  const firmaActual = firmas.find((f) => f.id === empresa.firma_id);
  const [version, setVersion] = useState(0);
  const [invitar, setInvitar] = useState(false);
  const [editar, setEditar] = useState<Miembro | null>(null);
  const [quitar, setQuitar] = useState<Miembro | null>(null);
  const { datos, error } = useDatos(() => firma.equipo(empresa.firma_id), [firma, empresa.firma_id, version]);
  const recargar = () => setVersion((v) => v + 1);
  const empresasFirma = empresas.filter((e) => e.firma_id === empresa.firma_id);
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.razon_social ?? 'Otra empresa';

  async function accion(fn: () => Promise<void>, ok: string) {
    try { await fn(); avisar(ok, 'ok'); recargar(); } catch (e) { avisar((e as Error).message, 'danger'); }
  }

  if (!esAdministrador(firmaActual)) {
    return <><div className="page-head"><h1>Equipo de la firma</h1></div>
      <div className="panel"><Vacio icono="lock">Solo los administradores de la firma gestionan el equipo.</Vacio></div></>;
  }
  const accesos = (a: AccesoEmpresa[]) => a.length
    ? a.map((x) => <span key={x.empresa_id} className="pill" style={{ margin: '2px 4px 2px 0' }}>{nombreEmpresa(x.empresa_id)}: {NOMBRE_ROL[x.rol]}</span>)
    : <span className="hint">—</span>;

  return (
    <>
      <div className="page-head split">
        <div><h1>Equipo de la firma</h1><p>{firmaActual!.nombre}. Los administradores ven todas las empresas; los demás, solo las que se les asignen.</p></div>
        <div className="btn-row"><button className="btn primary" onClick={() => setInvitar(true)}><Icono nombre="userPlus" />Invitar</button></div>
      </div>
      {modo === 'demo' && <div className="notice">En la demostración el equipo es simulado: los cambios no se guardan ni se envían correos.</div>}
      {error && <div className="notice danger">{error.message}</div>}
      <div className="panel">
        <div className="panel-head"><h2>Miembros</h2></div>
        {datos ? (
          <div className="table-wrap"><table>
            <thead><tr><th className="wrap">Nombre</th><th>Rol en la firma</th><th className="wrap">Empresas</th><th></th></tr></thead>
            <tbody>{datos.miembros.map((m) => (
              <tr key={m.usuario_id}>
                <td className="wrap"><b>{m.nombre}</b><div className="hint">{m.correo}</div></td>
                <td>{NOMBRE_ROL_FIRMA[m.rol_firma]}</td>
                <td className="wrap">{m.rol_firma === 'miembro' ? accesos(m.empresas) : <span className="hint">Todas (administrador)</span>}</td>
                <td className="acciones-fila">{m.rol_firma !== 'propietario' && <>
                  <button className="btn sm" aria-label={`Accesos de ${m.nombre}`} onClick={() => setEditar(m)}>Accesos</button>
                  <button className="btn sm" aria-label={`Quitar a ${m.nombre}`} onClick={() => setQuitar(m)}>Quitar</button></>}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="users">{error ? 'No se pudo cargar el equipo.' : 'Cargando…'}</Vacio>}
      </div>
      {datos && datos.invitaciones.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Invitaciones pendientes</h2></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Correo</th><th>Rol</th><th className="wrap">Empresas</th><th>Vence</th><th></th></tr></thead>
            <tbody>{datos.invitaciones.map((i) => (
              <tr key={i.id}>
                <td>{i.correo}</td><td>{NOMBRE_ROL_FIRMA[i.rol_firma]}</td>
                <td className="wrap">{i.rol_firma === 'miembro' ? accesos(i.empresas) : <span className="hint">Todas</span>}</td>
                <td>{fecha(i.expira_en)}</td>
                <td className="acciones-fila"><button className="btn sm" onClick={() => void accion(() => firma.revocarInvitacion(i.id), 'Invitación revocada.')}>Revocar</button></td>
              </tr>))}
            </tbody></table></div>
        </div>)}
      {invitar && <Invitar empresas={empresasFirma} alCerrar={() => setInvitar(false)} alInvitar={recargar} />}
      {quitar && (
        <Modal titulo={`Quitar a ${quitar.nombre}`} alCerrar={() => setQuitar(null)} pie={<>
          <button className="btn" onClick={() => setQuitar(null)}>Cancelar</button>
          <button className="btn danger" onClick={() => { const m = quitar; setQuitar(null); void accion(() => firma.quitarMiembro(empresa.firma_id, m.usuario_id), `${m.nombre} ya no es parte de la firma.`); }}>Quitar de la firma</button></>}>
          <p>{quitar.nombre} ({quitar.correo}) perderá el acceso a todas las empresas de la firma. Lo que ya registró se conserva con su nombre en la auditoría.</p>
        </Modal>)}
      {editar && <Accesos miembro={editar} empresas={empresasFirma} alCerrar={() => setEditar(null)} alGuardar={recargar} />}
    </>
  );
}

/** Selector de rol por empresa: "Sin acceso" o uno de los roles de la sección 10. */
function RolesPorEmpresa({ empresas, valores, cambiar }: { empresas: EmpresaLocal[]; valores: Record<string, RolEmpresa | ''>; cambiar: (id: string, rol: RolEmpresa | '') => void }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th className="wrap">Empresa</th><th>Rol</th></tr></thead>
      <tbody>{empresas.map((e) => (
        <tr key={e.id}><td className="wrap">{e.razon_social}</td>
          <td><select aria-label={`Rol en ${e.razon_social}`} value={valores[e.id] ?? ''} onChange={(x) => cambiar(e.id, x.target.value as RolEmpresa | '')}>
            <option value="">Sin acceso</option>
            {ROLES_EMPRESA.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
          </select></td></tr>))}
      </tbody></table></div>
  );
}

function Invitar({ empresas, alCerrar, alInvitar }: { empresas: EmpresaLocal[]; alCerrar: () => void; alInvitar: () => void }) {
  const { firma, empresa, avisar } = useApp();
  const [correo, setCorreo] = useState('');
  const [rolFirma, setRolFirma] = useState<'miembro' | 'administrador'>('miembro');
  const [roles, setRoles] = useState<Record<string, RolEmpresa | ''>>({});
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar() {
    setError(null);
    const accesos = Object.entries(roles).filter(([, r]) => r).map(([empresa_id, rol]) => ({ empresa_id, rol: rol as RolEmpresa }));
    if (rolFirma === 'miembro' && accesos.length === 0) { setError('Asigne al menos una empresa con un rol, o invite como administrador.'); return; }
    setOcupado(true);
    try {
      await firma.invitar(empresa.firma_id, correo, rolFirma, rolFirma === 'miembro' ? accesos : []);
      avisar(`Invitación enviada a ${correo.trim()}.`, 'ok');
      alInvitar();
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo="Invitar al equipo" ancho alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={alCerrar}>Cancelar</button>
      <button className="btn primary" disabled={ocupado} onClick={() => void enviar()}>{ocupado ? 'Enviando…' : 'Enviar invitación'}</button></>}>
      <div className="grid2">
        <div className="field"><label htmlFor="iCorreo">Correo</label><input id="iCorreo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@firma.co" /></div>
        <div className="field"><label htmlFor="iRol">Rol en la firma</label>
          <select id="iRol" value={rolFirma} onChange={(e) => setRolFirma(e.target.value as 'miembro' | 'administrador')}>
            <option value="miembro">Miembro (solo las empresas que se le asignen)</option>
            <option value="administrador">Administrador (todas las empresas; exige verificación en dos pasos)</option>
          </select></div>
      </div>
      {rolFirma === 'miembro' && <RolesPorEmpresa empresas={empresas} valores={roles} cambiar={(id, r) => setRoles((x) => ({ ...x, [id]: r }))} />}
      <p className="hint">Le llegará un correo con un enlace (vence en 7 días). Con el código del enlace entra a Contafi con su propia cuenta.</p>
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}

function Accesos({ miembro, empresas, alCerrar, alGuardar }: { miembro: Miembro; empresas: EmpresaLocal[]; alCerrar: () => void; alGuardar: () => void }) {
  const { firma, empresa, avisar } = useApp();
  const inicial = Object.fromEntries(miembro.empresas.map((x) => [x.empresa_id, x.rol])) as Record<string, RolEmpresa | ''>;
  const [roles, setRoles] = useState(inicial);
  const [rolFirma, setRolFirma] = useState(miembro.rol_firma as 'miembro' | 'administrador');
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    try {
      if (rolFirma !== miembro.rol_firma) await firma.cambiarRolFirma(empresa.firma_id, miembro.usuario_id, rolFirma);
      for (const e of empresas) {
        const nuevo = roles[e.id] || null;
        if (nuevo !== (inicial[e.id] || null)) await firma.asignarRol(e.id, miembro.usuario_id, nuevo);
      }
      avisar(`Accesos de ${miembro.nombre} actualizados.`, 'ok');
      alGuardar();
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
      alGuardar();
    }
  }

  return (
    <Modal titulo={`Accesos de ${miembro.nombre}`} ancho alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      <div className="field"><label htmlFor="aRol">Rol en la firma</label>
        <select id="aRol" value={rolFirma} onChange={(e) => setRolFirma(e.target.value as 'miembro' | 'administrador')}>
          <option value="miembro">Miembro</option><option value="administrador">Administrador</option>
        </select></div>
      {rolFirma === 'miembro'
        ? <RolesPorEmpresa empresas={empresas} valores={roles} cambiar={(id, r) => setRoles((x) => ({ ...x, [id]: r }))} />
        : <p className="hint">Los administradores trabajan en todas las empresas de la firma, invitan y asignan roles. Deben usar verificación en dos pasos.</p>}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
