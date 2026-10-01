import { useState } from 'react';
import { RESPONSABILIDADES_FISCALES, calcularDV, esResponsabilidadConocida } from '@contafi/shared';
import {
  crearTercero, editarTercero, tercerosLocales, ErrorLocal, PLANTILLA_TERCEROS, leerTercerosCsv, importarTerceros, type LecturaTerceros, type TerceroLocal,
} from '@contafi/local';
import { TIPOS_TERCERO } from '@contafi/sync';
import { useApp, useDatos } from '../estado.tsx';
import { Icono, Modal, Vacio } from '../componentes/comunes.tsx';

const TIPOS_DOC: Record<string, string> = { '31': 'NIT', '13': 'Cédula', '22': 'Cédula de extranjería', '41': 'Pasaporte', '12': 'Tarjeta de identidad' };

export function Terceros() {
  const { base, empresa, version } = useApp();
  const [buscar, setBuscar] = useState('');
  const [editar, setEditar] = useState<TerceroLocal | null | undefined>(undefined);
  const [importar, setImportar] = useState(false);
  const { datos } = useDatos(() => tercerosLocales(base, empresa.id, buscar.trim()), [base, empresa.id, version, buscar]);

  return (
    <>
      <div className="page-head split">
        <div><h1>Terceros</h1><p>Clientes, proveedores y empleados. Se pueden crear sin conexión.</p></div>
        <div className="btn-row">
          <button className="btn" onClick={() => setImportar(true)}><Icono nombre="file" />Importar CSV</button>
          <button className="btn primary" onClick={() => setEditar(null)}><Icono nombre="plus" />Nuevo tercero</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Directorio</h2>
          <input type="search" placeholder="Buscar por nombre o documento…" aria-label="Buscar tercero" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 260 }} /></div>
        {datos?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Documento</th><th className="wrap">Nombre / razón social</th><th>Tipo</th><th>Responsabilidades</th><th>Correo</th><th>Estado</th><th></th></tr></thead>
            <tbody>{datos.map((t) => (
              <tr key={t.id}>
                <td className="mono">{TIPOS_DOC[t.tipo_doc] ?? t.tipo_doc} {t.numero}{t.dv != null ? `-${t.dv}` : ''}</td>
                <td className="wrap">{t.nombre}</td>
                <td>{t.tipos.join(', ')}</td>
                <td className="mono">{t.responsabilidades.join(' ')}</td>
                <td>{t.correo ?? ''}</td>
                <td>{t.errores_sync ? <span className="pill annulled" title={t.errores_sync}>Rechazado</span>
                  : t.pendiente ? <span className="pill draft">Pendiente</span> : <span className="pill posted">Sincronizado</span>}</td>
                <td className="acciones-fila"><button className="btn sm" aria-label={`Editar ${t.nombre}`} onClick={() => setEditar(t)}>Editar</button></td>
              </tr>))}
            </tbody></table></div>
        ) : <Vacio icono="users">{datos ? 'No hay terceros que coincidan.' : 'Cargando…'}</Vacio>}
      </div>
      {editar !== undefined && <EditarTercero actual={editar} alCerrar={() => setEditar(undefined)} />}
      {importar && <ImportarTerceros alCerrar={() => setImportar(false)} />}
    </>
  );
}

function EditarTercero({ actual, alCerrar }: { actual: TerceroLocal | null; alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [tipoDoc, setTipoDoc] = useState(actual?.tipo_doc ?? '31');
  const [numero, setNumero] = useState(actual?.numero ?? '');
  const [nombre, setNombre] = useState(actual?.nombre ?? '');
  const [correo, setCorreo] = useState(actual?.correo ?? '');
  const [municipio, setMunicipio] = useState(actual?.municipio ?? '');
  const [direccion, setDireccion] = useState(actual?.direccion ?? '');
  const [tipos, setTipos] = useState<string[]>(actual?.tipos ?? ['cliente']);
  const [responsabilidades, setResponsabilidades] = useState<string[]>(actual?.responsabilidades ?? []);
  const [activo, setActivo] = useState(actual?.activo ?? true);
  const [error, setError] = useState<string | null>(null);
  const limpio = numero.replace(/\D/g, '');
  let dv: number | null = null;
  try { dv = tipoDoc === '31' && limpio ? calcularDV(limpio) : null; } catch { dv = null; }
  // Códigos que vinieron en facturas importadas y no están en el catálogo: se conservan.
  const otras = responsabilidades.filter((r) => !esResponsabilidadConocida(r));
  const alternar = (lista: string[], v: string, si: boolean) => (si ? [...lista, v] : lista.filter((x) => x !== v));

  async function guardar() {
    setError(null);
    try {
      const datos = {
        tipo_doc: tipoDoc, numero: tipoDoc === '31' || tipoDoc === '13' ? limpio : numero.trim(), dv, nombre, correo: correo.trim() || null,
        municipio: municipio.trim() || null, direccion: direccion.trim() || null, responsabilidades, activo,
        tipos: tipos as (typeof TIPOS_TERCERO)[number][],
      };
      if (actual) await editarTercero(base, actual.id, datos);
      else await crearTercero(base, empresa.id, datos);
      avisar('Tercero guardado.', 'ok');
      refrescar();
      alCerrar();
      void sincronizarAhora();
    } catch (e) {
      setError(e instanceof ErrorLocal ? e.message : (e as Error).message);
    }
  }

  return (
    <Modal titulo={actual ? actual.nombre : 'Nuevo tercero'} ancho alCerrar={alCerrar} pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()}>Guardar</button></>}>
      {actual?.errores_sync && <div className="notice danger">El servidor rechazó este tercero: {actual.errores_sync}</div>}
      <div className="grid2">
        <div className="field"><label htmlFor="tTipo">Tipo de documento</label>
          <select id="tTipo" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
            {Object.entries(TIPOS_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="field"><label htmlFor="tNum">Número{dv != null ? ` (DV ${dv})` : ''}</label>
          <input type="text" id="tNum" className="mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={tipoDoc === '31' ? '900123456' : ''} /></div>
      </div>
      <div className="field"><label htmlFor="tNombre">Nombre o razón social</label><input type="text" id="tNombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="tCorreo">Correo (opcional)</label><input id="tCorreo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} /></div>
        <div className="field"><label htmlFor="tMunicipio">Municipio (opcional)</label><input type="text" id="tMunicipio" value={municipio} onChange={(e) => setMunicipio(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="tDireccion">Dirección (opcional)</label><input type="text" id="tDireccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
      <div className="field"><label>Es</label>
        <div className="btn-row">{TIPOS_TERCERO.map((t) => (
          <label key={t} className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={tipos.includes(t)} onChange={(e) => setTipos((x) => alternar(x, t, e.target.checked))} /> {t}
          </label>))}</div></div>
      <div className="field"><label>Responsabilidades fiscales (RUT)</label>
        <div className="btn-row">{Object.entries(RESPONSABILIDADES_FISCALES).map(([codigo, texto]) => (
          <label key={codigo} className="chip" style={{ cursor: 'pointer' }} title={texto}>
            <input type="checkbox" aria-label={`${codigo} ${texto}`} checked={responsabilidades.includes(codigo)}
              onChange={(e) => setResponsabilidades((x) => alternar(x, codigo, e.target.checked))} /> {codigo} · {texto}
          </label>))}
          {otras.map((r) => <span key={r} className="chip" title="Código recibido en una factura electrónica">{r}</span>)}</div></div>
      {actual && <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}

function ImportarTerceros({ alCerrar }: { alCerrar: () => void }) {
  const { base, empresa, avisar, refrescar, sincronizarAhora } = useApp();
  const [lectura, setLectura] = useState<LecturaTerceros | null>(null);
  const [omitidos, setOmitidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function descargarPlantilla() {
    // Con BOM para que Excel reconozca las tildes.
    const url = URL.createObjectURL(new Blob(['\uFEFF' + PLANTILLA_TERCEROS], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla-terceros.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importar() {
    setError(null);
    try {
      const r = await importarTerceros(base, empresa.id, lectura!.terceros);
      avisar(`${r.creados} tercero(s) importado(s)${r.omitidos.length ? `, ${r.omitidos.length} ya existían` : ''}.`, 'ok');
      refrescar();
      void sincronizarAhora();
      if (r.omitidos.length) { setOmitidos(r.omitidos); setLectura(null); } else alCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const listos = lectura && lectura.errores.length === 0 && lectura.terceros.length > 0;
  return (
    <Modal titulo="Importar terceros" ancho="xl" alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={descargarPlantilla}><Icono nombre="file" />Descargar plantilla</button>
      <button className="btn" onClick={alCerrar}>Cerrar</button>
      <button className="btn primary" disabled={!listos} onClick={() => void importar()}>Importar {lectura?.terceros.length ? `${lectura.terceros.length} tercero(s)` : ''}</button></>}>
      <p className="hint" style={{ marginTop: 0 }}>Una fila por tercero: tipo de documento (NIT, CC, CE, PASAPORTE o TI), número, DV (si se deja vacío se calcula), nombre, tipos separados por coma (cliente, proveedor, empleado, otro), correo, municipio, dirección y responsabilidades fiscales (O-13, O-15, O-23, O-47 o R-99-PN). Guarda el archivo de Excel como <b>CSV</b>.</p>
      <div className="field"><label htmlFor="iArchivo">Archivo CSV</label>
        <input id="iArchivo" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { setOmitidos([]); setLectura(leerTercerosCsv(t)); }); }} /></div>
      {lectura && lectura.errores.length > 0 && <div className="notice danger"><b>Corrija el archivo:</b><ul>{lectura.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {omitidos.length > 0 && <div className="notice"><b>No se importaron porque ya existían:</b><ul>{omitidos.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {lectura && lectura.terceros.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Documento</th><th className="wrap">Nombre</th><th>Tipo</th><th>Correo</th></tr></thead>
          <tbody>{lectura.terceros.map((t, i) => (
            <tr key={i}><td className="mono">{TIPOS_DOC[t.tipo_doc] ?? t.tipo_doc} {t.numero}{t.dv != null ? `-${t.dv}` : ''}</td>
              <td className="wrap">{t.nombre}</td><td>{(t.tipos ?? []).join(', ')}</td><td>{t.correo ?? ''}</td></tr>))}
          </tbody></table></div>)}
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
