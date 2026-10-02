import { useState } from 'react';
import { codigoPadre, errorCodigoCuentaNueva } from '@contafi/shared';
import {
  crearCuenta, descartarCuentaRechazada, editarCuenta, importarPuc, leerPucCsv, planDeCuentas, ErrorLocal, PLANTILLA_PUC,
  type CuentaPlan, type LecturaPuc,
} from '@contafi/local';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio } from '../componentes/comunes.tsx';

type Edicion = { tipo: 'nueva'; prefijo: string } | { tipo: 'editar'; cuenta: CuentaPlan };

export function Cuentas() {
  const { base, empresa, version } = useApp();
  const [buscar, setBuscar] = useState('');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [importar, setImportar] = useState(false);
  const { datos } = useDatos(() => planDeCuentas(base, empresa.id), [base, empresa.id, version]);
  const q = buscar.trim().toLowerCase();
  const lista = (datos ?? []).filter((c) => !q || c.codigo.startsWith(q) || c.nombre.toLowerCase().includes(q));

  return (
    <>
      <div className="page-head split">
        <div><h1>Plan de cuentas</h1><p>PUC de la empresa. Solo las cuentas auxiliares reciben movimientos.</p></div>
        <div className="btn-row">
          <button className="btn" onClick={() => setImportar(true)}><Icono nombre="file" />Importar CSV</button>
          <button className="btn primary" onClick={() => setEdicion({ tipo: 'nueva', prefijo: '' })}><Icono nombre="plus" />Nueva cuenta</button></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>{lista.length} cuentas</h2>
          <input type="search" placeholder="Buscar por código o nombre…" aria-label="Buscar cuenta" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 280 }} /></div>
        {lista.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Código</th><th className="wrap">Nombre</th><th>Naturaleza</th><th>Tipo</th><th>Exige tercero</th><th>Estado</th><th></th></tr></thead>
            <tbody>{lista.map((c) => (
              <tr key={c.codigo} className={`fila-puc n${c.nivel}${c.activa ? '' : ' inactiva'}`}>
                <td className="mono">{c.codigo}</td>
                <td className="wrap" style={{ paddingLeft: 12 + (c.nivel - 1) * 16, fontWeight: c.aceptaMovimiento ? 400 : 600 }}>{c.nombre}</td>
                <td>{c.naturaleza === 'D' ? 'Débito' : 'Crédito'}</td>
                <td>{c.aceptaMovimiento ? <span className="pill posted">Auxiliar</span> : <span className="pill open">Mayor</span>}</td>
                <td>{c.exigeTercero ? 'Sí' : ''}</td>
                <td>{c.errorSync ? <span className="pill annulled" title={c.errorSync}>Rechazada</span>
                  : c.pendiente ? <span className="pill draft">Pendiente</span>
                  : !c.activa ? <span className="pill">Inactiva</span> : ''}</td>
                <td className="acciones-fila">{c.nivel >= 3 && <>
                  {c.activa && c.codigo.length < 12 && <button className="btn sm" title={`Crear una subcuenta de ${c.codigo}`} aria-label={`Subcuenta de ${c.codigo}`}
                    onClick={() => setEdicion({ tipo: 'nueva', prefijo: c.codigo })}><Icono nombre="plus" /></button>}
                  <button className="btn sm" aria-label={`Editar ${c.codigo}`} onClick={() => setEdicion({ tipo: 'editar', cuenta: c })}>Editar</button>
                </>}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="tree">{datos ? 'Ninguna cuenta coincide.' : 'Cargando…'}</Vacio>}
      </div>
      {edicion && <EditarCuenta edicion={edicion} cuentas={datos ?? []} alCerrar={() => setEdicion(null)} />}
      {importar && <ImportarPuc existentes={new Set((datos ?? []).map((c) => c.codigo))} alCerrar={() => setImportar(false)} />}
    </>
  );
}

function EditarCuenta({ edicion, cuentas, alCerrar }: { edicion: Edicion; cuentas: CuentaPlan[]; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const actual = edicion.tipo === 'editar' ? edicion.cuenta : null;
  const [codigo, setCodigo] = useState(edicion.tipo === 'nueva' ? edicion.prefijo : edicion.cuenta.codigo);
  const [nombre, setNombre] = useState(actual?.nombre ?? '');
  const [exigeTercero, setExigeTercero] = useState(actual?.exigeTercero ?? false);
  const [exigeCentro, setExigeCentro] = useState(actual?.exigeCentroCosto ?? false);
  const [activa, setActiva] = useState(actual?.activa ?? true);
  const [error, setError] = useState<string | null>(null);

  // Vista previa de la cuenta nueva: dónde queda en el árbol y qué naturaleza hereda.
  const errorCodigo = codigo.length >= 4 ? errorCodigoCuentaNueva(codigo) : null;
  const padre = !actual && codigo.length >= 4 && !errorCodigo ? cuentas.find((c) => c.codigo === codigoPadre(codigo)) : undefined;

  async function guardar() {
    setError(null);
    try {
      const datos = { nombre, exigeTercero, exigeCentroCosto: exigeCentro, activa };
      if (actual) await editarCuenta(base, empresa.id, actual.codigo, datos);
      else await crearCuenta(base, empresa.id, codigo, datos);
      avisar(actual ? `Cuenta ${actual.codigo} actualizada.` : `Cuenta ${codigo} creada.`, 'ok');
      refrescar();
      alCerrar();
      void sincronizarAhora();
    } catch (e) {
      setError(e instanceof ErrorLocal ? e.message : (e as Error).message);
    }
  }

  async function descartar() {
    try {
      await descartarCuentaRechazada(base, empresa.id, actual!.codigo);
      avisar(actual!.enServidor ? 'Se dejaron los datos del servidor.' : `Cuenta ${actual!.codigo} descartada.`, 'ok');
      refrescar();
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal titulo={actual ? `Cuenta ${actual.codigo}` : 'Nueva cuenta'} alCerrar={alCerrar} pie={<>
      {actual?.errorSync && <button className="btn" onClick={() => void descartar()}>{actual.enServidor ? 'Quitar aviso' : 'Descartar cuenta'}</button>}
      <button className="btn" onClick={alCerrar}>Cancelar</button>
      <button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      {actual?.errorSync && (
        <div className="notice danger"><b>El servidor rechazó el último cambio:</b> {actual.errorSync}
          {actual.enServidor ? ' Se muestran los datos que tiene el servidor.' : ' La cuenta existe solo en este equipo.'}</div>)}
      <div className="grid2">
        <div className="field"><label htmlFor="cCodigo">Código</label>
          <input type="text" id="cCodigo" className="mono" inputMode="numeric" value={codigo} disabled={!!actual}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="11200501" /></div>
        <div className="field"><label>Naturaleza</label>
          <input type="text" disabled value={actual ? (actual.naturaleza === 'D' ? 'Débito' : 'Crédito') : padre ? `${padre.naturaleza === 'D' ? 'Débito' : 'Crédito'} (de ${padre.codigo})` : ''} /></div>
      </div>
      {!actual && (
        <p className="hint" style={{ marginTop: 0 }}>
          {errorCodigo ? errorCodigo
            : padre ? <>Subcuenta de <b>{padre.codigo} {padre.nombre}</b>.{padre.aceptaMovimiento && ' Esa cuenta dejará de recibir movimientos (si ya tiene, no se puede).'}</>
            : codigo.length >= 4 ? `Primero cree la cuenta ${codigoPadre(codigo)}.`
            : 'Cuentas de 4 dígitos, subcuentas de 6 y auxiliares de 8, 10 o 12. Las clases y los grupos los fija el PUC.'}
        </p>)}
      <div className="field"><label htmlFor="cNombre">Nombre</label><input type="text" id="cNombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Davivienda cuenta de ahorros 9981" /></div>
      <div className="field"><label>Opciones</label>
        <div className="btn-row">
          <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={exigeTercero} onChange={(e) => setExigeTercero(e.target.checked)} /> Exige tercero</label>
          <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={exigeCentro} onChange={(e) => setExigeCentro(e.target.checked)} /> Exige centro de costo</label>
          {actual && <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa</label>}
        </div></div>
      <p className="hint">Solo el contador o el administrador modifican el plan de cuentas. Los cambios se pueden hacer sin conexión; el servidor los confirma al sincronizar.</p>
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}

/** Migración: trae el plan de cuentas del software anterior; crea solo las cuentas que faltan. */
function ImportarPuc({ existentes, alCerrar }: { existentes: Set<string>; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [lectura, setLectura] = useState<LecturaPuc | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const nuevas = lectura?.filas.filter((f) => !existentes.has(f.codigo)) ?? [];

  function descargarPlantilla() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + PLANTILLA_PUC], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: 'plantilla-plan-de-cuentas.csv' }).click();
    URL.revokeObjectURL(url);
  }

  async function importar() {
    setOcupado(true);
    try {
      const r = await importarPuc(base, empresa.id, lectura!.filas);
      refrescar();
      void sincronizarAhora();
      avisar(`${r.creadas} cuenta(s) creada(s)${r.existentes ? `; ${r.existentes} ya existían` : ''}.`, r.errores.length ? '' : 'ok');
      if (r.errores.length) setErrores(r.errores); else alCerrar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo="Importar plan de cuentas" ancho alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={descargarPlantilla}><Icono nombre="file" />Descargar plantilla</button>
      <button className="btn" onClick={alCerrar}>Cerrar</button>
      <button className="btn primary" disabled={!nuevas.length || ocupado || !!lectura?.errores.length} onClick={() => void importar()}>
        {ocupado ? 'Creando…' : `Crear ${nuevas.length} cuenta(s)`}</button></>}>
      <p className="hint" style={{ marginTop: 0 }}>Exporta el plan de cuentas del software anterior a Excel y guárdalo como <b>CSV</b>: código, nombre y, si quieres,
        "sí" en una tercera columna para las cuentas que exigen tercero. Se crean solo las cuentas que faltan (de 4 dígitos en adelante); las que ya existen no se tocan.</p>
      <div className="field"><label htmlFor="pArchivo">Archivo CSV</label>
        <input id="pArchivo" type="file" accept=".csv,.txt,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { setErrores([]); setLectura(leerPucCsv(t)); }); }} /></div>
      {lectura && lectura.errores.length > 0 && <div className="notice danger"><b>Corrija el archivo:</b><ul>{lectura.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {lectura && !lectura.errores.length && <p>{lectura.filas.length} cuentas en el archivo: <b>{nuevas.length} nuevas</b>, {lectura.filas.length - nuevas.length} ya existen.</p>}
      {nuevas.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 260 }}><table>
          <thead><tr><th>Código</th><th className="wrap">Nombre</th><th>Exige tercero</th></tr></thead>
          <tbody>{nuevas.slice(0, 200).map((f) => <tr key={f.codigo}><td className="mono">{f.codigo}</td><td className="wrap">{f.nombre}</td><td>{f.exigeTercero ? 'Sí' : ''}</td></tr>)}</tbody>
        </table></div>)}
      {errores.length > 0 && <div className="notice danger"><b>No se pudieron crear:</b><ul>{errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </Modal>
  );
}
