import { useState } from 'react';
import { calcularDV, limpiarNit } from '@contafi/shared';
import { useApp } from '../estado.tsx';
import { Modal } from '../componentes/comunes.tsx';
import type { EmpresaNueva } from '../datos/firma.ts';

export const EMPRESA_VACIA: EmpresaNueva = { nit: '', razonSocial: '', grupoNiif: 2, municipio: '' };

/** Campos de una empresa cliente. El DV se calcula (el servidor lo vuelve a verificar). */
export function CamposEmpresa({ datos, cambiar }: { datos: EmpresaNueva; cambiar: (d: EmpresaNueva) => void }) {
  const nit = limpiarNit(datos.nit);
  let dv: number | null = null;
  try { dv = /^\d{5,15}$/.test(nit) ? calcularDV(nit) : null; } catch { dv = null; }
  return (
    <>
      <div className="grid2">
        <div className="field"><label htmlFor="eNit">NIT{dv != null ? ` (DV ${dv})` : ''}</label>
          <input type="text" id="eNit" className="mono" inputMode="numeric" value={datos.nit} placeholder="900123456" onChange={(e) => cambiar({ ...datos, nit: e.target.value })} /></div>
        <div className="field"><label htmlFor="eGrupo">Grupo NIIF</label>
          <select id="eGrupo" value={datos.grupoNiif} onChange={(e) => cambiar({ ...datos, grupoNiif: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>Grupo 1 (NIIF plenas)</option><option value={2}>Grupo 2 (NIIF para pymes)</option><option value={3}>Grupo 3 (microempresas)</option>
          </select></div>
      </div>
      <div className="field"><label htmlFor="eRazon">Razón social</label>
        <input type="text" id="eRazon" value={datos.razonSocial} placeholder="Comercializadora Andina S.A.S." onChange={(e) => cambiar({ ...datos, razonSocial: e.target.value })} /></div>
      <div className="field"><label htmlFor="eMunicipio">Municipio (opcional)</label>
        <input type="text" id="eMunicipio" value={datos.municipio} placeholder="Bogotá D.C." onChange={(e) => cambiar({ ...datos, municipio: e.target.value })} /></div>
      <p className="hint">Se crea con el PUC de la plantilla y los tipos de comprobante estándar; después puedes cargar los saldos iniciales y los terceros.</p>
    </>
  );
}

/** Alta de una empresa cliente desde la app (solo administradores de la firma). */
export function NuevaEmpresa({ alCerrar }: { alCerrar: () => void }) {
  const { firma, empresa, recargarEmpresas, cambiarEmpresa, ir, avisar } = useApp();
  const [datos, setDatos] = useState(EMPRESA_VACIA);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    setError(null);
    setOcupado(true);
    try {
      const nueva = await firma.crearEmpresa(empresa.firma_id, datos);
      await recargarEmpresas();
      cambiarEmpresa(nueva.id);
      avisar(`${nueva.razon_social} creada.`, 'ok');
      ir('saldos');
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo="Nueva empresa" alCerrar={alCerrar} pie={<>
      <button className="btn" onClick={alCerrar}>Cancelar</button>
      <button className="btn primary" disabled={ocupado} onClick={() => void crear()}>{ocupado ? 'Creando…' : 'Crear empresa'}</button></>}>
      <CamposEmpresa datos={datos} cambiar={setDatos} />
      {error && <div className="notice danger" role="alert">{error}</div>}
    </Modal>
  );
}
