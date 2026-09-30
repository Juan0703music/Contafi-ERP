import { calcularDV, limpiarNit } from '@contafi/shared';
import { ErrorMotor, type ParametrosAnuales } from '@contafi/motor';
import {
  leerDocumentoDian, leerZip, proponerAsiento, aprenderRegla,
  type DocumentoDian, type PropuestaAsiento, type ReglasProveedor,
} from '@contafi/dian-xml';
import { s, type BaseLocal } from './base.ts';
import { crearComprobante, crearTercero } from './contabilidad.ts';

export interface ArchivoEntrada {
  nombre: string;
  contenido: Uint8Array;
}

export type EstadoImportacion = 'nuevo' | 'duplicado' | 'ajeno' | 'error';

export interface ItemImportacion {
  archivo: string;
  estado: EstadoImportacion;
  mensaje: string | null;
  documento: DocumentoDian | null;
  propuesta: PropuestaAsiento | null;
  /** Tercero ya existente en la empresa (por NIT); si es null se crea al contabilizar. */
  terceroId: string | null;
}

const texto = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
const esZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK"

export async function reglasProveedor(base: BaseLocal, empresa: string): Promise<ReglasProveedor> {
  const filas = await base.consultar<{ nit: string; cuenta: string }>('select nit, cuenta from reglas_proveedor where empresa_id = ?', [empresa]);
  return Object.fromEntries(filas.map((f) => [f.nit, f.cuenta]));
}

/**
 * Lee XML y ZIP de la DIAN y propone el asiento de cada documento, sin guardar nada todavía.
 * Marca los duplicados (mismo CUFE ya importado o repetido en la misma carga) y los documentos de otra empresa.
 */
export async function prepararImportacion(
  base: BaseLocal, empresa: { id: string; nit: string }, archivos: readonly ArchivoEntrada[], parametros: ParametrosAnuales,
): Promise<ItemImportacion[]> {
  const leidos: { archivo: string; documento?: DocumentoDian; error?: string }[] = [];
  for (const a of archivos) {
    if (esZip(a.contenido)) {
      for (const x of leerZip(a.contenido)) leidos.push({ archivo: `${a.nombre} → ${x.nombre}`, documento: x.documento, error: x.error });
    } else {
      try {
        leidos.push({ archivo: a.nombre, documento: leerDocumentoDian(texto(a.contenido)) });
      } catch (e) {
        leidos.push({ archivo: a.nombre, error: (e as Error).message });
      }
    }
  }

  const reglas = await reglasProveedor(base, empresa.id);
  const yaImportados = new Set((await base.consultar<{ cufe: string }>('select cufe from documentos_dian where empresa_id = ?', [empresa.id])).map((f) => f.cufe));
  const vistos = new Set<string>();
  const items: ItemImportacion[] = [];

  for (const l of leidos) {
    if (!l.documento) {
      items.push({ archivo: l.archivo, estado: 'error', mensaje: l.error ?? 'No se pudo leer.', documento: null, propuesta: null, terceroId: null });
      continue;
    }
    const d = l.documento;
    if (d.cufe && (yaImportados.has(d.cufe) || vistos.has(d.cufe))) {
      items.push({ archivo: l.archivo, estado: 'duplicado', mensaje: `El documento ${d.numero} ya fue importado (mismo CUFE).`, documento: d, propuesta: null, terceroId: null });
      continue;
    }
    vistos.add(d.cufe);
    let propuesta: PropuestaAsiento;
    try {
      propuesta = proponerAsiento(d, { nitEmpresa: empresa.nit, parametros, reglas });
    } catch (e) {
      items.push({ archivo: l.archivo, estado: 'ajeno', mensaje: (e as Error).message, documento: d, propuesta: null, terceroId: null });
      continue;
    }
    const [t] = await base.consultar<{ id: string }>(
      `select id from terceros where empresa_id = ? and tipo_doc = '31' and numero = ?`, [empresa.id, limpiarNit(propuesta.tercero.nit)]);
    items.push({ archivo: l.archivo, estado: 'nuevo', mensaje: null, documento: d, propuesta, terceroId: t?.id ?? null });
  }
  return items;
}

export interface ResultadoImportacion {
  contabilizados: { cufe: string; numeroLocal: string }[];
  fallidos: { cufe: string; numero: string; mensaje: string }[];
  tercerosCreados: number;
  reglasAprendidas: number;
}

/**
 * Contabiliza los documentos elegidos. Por cada uno, en una sola transacción: el comprobante, el registro
 * del documento DIAN (para no importarlo dos veces) y, si el contador cambió la cuenta, la regla del proveedor.
 * La clave de idempotencia usa el CUFE: si otro PC ya importó la misma factura, el servidor no la duplica.
 */
export async function contabilizarImportacion(
  base: BaseLocal, empresa: { id: string; nit: string },
  /** `cuenta`: solo si el contador cambió la cuenta sugerida. */
  seleccion: readonly { item: ItemImportacion; cuenta?: string }[],
): Promise<ResultadoImportacion> {
  const r: ResultadoImportacion = { contabilizados: [], fallidos: [], tercerosCreados: 0, reglasAprendidas: 0 };
  let reglas = await reglasProveedor(base, empresa.id);

  for (const { item, cuenta } of seleccion) {
    const d = item.documento!;
    const p = item.propuesta!;
    try {
      // 1. Tercero: el existente o uno nuevo con los datos del XML
      let terceroId = item.terceroId;
      if (!terceroId) {
        const nit = limpiarNit(p.tercero.nit);
        const [existente] = await base.consultar<{ id: string }>(
          `select id from terceros where empresa_id = ? and tipo_doc = '31' and numero = ?`, [empresa.id, nit]);
        if (existente) {
          terceroId = existente.id;
        } else {
          terceroId = await crearTercero(base, empresa.id, {
            tipo_doc: '31', numero: nit, dv: p.tercero.dv != null ? Number(p.tercero.dv) : calcularDV(nit),
            nombre: p.tercero.razonSocial || nit, tipos: [p.sentido === 'compra' ? 'proveedor' : 'cliente'],
            responsabilidades: p.tercero.responsabilidades, municipio: p.tercero.municipio, direccion: p.tercero.direccion,
            correo: p.tercero.correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.tercero.correo) ? p.tercero.correo : null,
          });
          r.tercerosCreados++;
        }
      }

      // 2. Cuenta: la elegida por el contador reemplaza la sugerida en la línea base
      const sugerida = p.cuentaSugerida.cuenta;
      const cuentaFinal = cuenta ?? sugerida;
      const lineas = p.lineas.map((l) => ({ ...l, terceroId, cuenta: l.cuenta === sugerida ? cuentaFinal : l.cuenta }));
      // Se aprende solo cuando el contador eligió una cuenta distinta a la que ya tenía el proveedor.
      const aprender = p.sentido === 'compra' && cuenta !== undefined && cuenta !== reglas[limpiarNit(p.tercero.nit)];
      const total = d.totalAPagar;

      const { numeroLocal } = await crearComprobante(base, empresa.id,
        { tipo: p.tipoComprobante, fecha: p.fecha, concepto: p.concepto, lineas, origen: 'importacion_dian' },
        {
          clave: `dian:${empresa.id}:${d.cufe}`,
          extra: (id) => [
            s(`insert into documentos_dian (empresa_id, cufe, tipo, sentido, numero, tercero_nit, tercero_nombre, fecha, total, comprobante_id, importado_en)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              empresa.id, d.cufe, d.tipo, p.sentido, d.numero, limpiarNit(p.tercero.nit), p.tercero.razonSocial, d.fechaEmision, total, id, new Date().toISOString()),
            ...(aprender ? [s(`insert into reglas_proveedor (empresa_id, nit, cuenta, actualizado_en) values (?, ?, ?, ?)
                               on conflict (empresa_id, nit) do update set cuenta = excluded.cuenta, actualizado_en = excluded.actualizado_en`,
              empresa.id, limpiarNit(p.tercero.nit), cuentaFinal, new Date().toISOString())] : []),
          ],
        });
      if (aprender) {
        reglas = aprenderRegla(reglas, p.tercero.nit, cuentaFinal);
        r.reglasAprendidas++;
      }
      r.contabilizados.push({ cufe: d.cufe, numeroLocal });
    } catch (e) {
      r.fallidos.push({ cufe: d.cufe, numero: d.numero, mensaje: e instanceof ErrorMotor ? e.errores.map((x) => x.mensaje).join(' ') : (e as Error).message });
    }
  }
  return r;
}
