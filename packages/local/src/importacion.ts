import { calcularDV, limpiarNit } from '@contafi/shared';
import { ErrorMotor, type ParametrosAnuales } from '@contafi/motor';
import {
  leerDocumentoDian, leerZip, proponerAsiento, aprenderRegla,
  type DocumentoDian, type PropuestaAsiento, type ReglasProveedor,
} from '@contafi/dian-xml';
import { s, type BaseLocal } from './base.ts';
import { crearComprobante, crearTercero } from './contabilidad.ts';
import { conceptosRetencion, parametrosDelAnio, retencionesDeProveedor, sentenciasAprenderRegla, type ConceptoConfigurado } from './retenciones.ts';

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
  /** Códigos de las retenciones aplicadas en la propuesta (compras): las aprendidas del proveedor. */
  retenciones: string[];
}

const texto = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
const esZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK"

export async function reglasProveedor(base: BaseLocal, empresa: string): Promise<ReglasProveedor> {
  const filas = await base.consultar<{ nit: string; cuenta: string }>(
    'select nit, cuenta from reglas_proveedor where empresa_id = ? and cuenta is not null', [empresa]);
  return Object.fromEntries(filas.map((f) => [f.nit, f.cuenta]));
}

/**
 * Lee XML y ZIP de la DIAN y propone el asiento de cada documento, sin guardar nada todavía.
 * Marca los duplicados (mismo CUFE ya importado o repetido en la misma carga) y los documentos de otra empresa.
 */
/** Vuelve a calcular la propuesta cuando el contador cambia las retenciones de un documento. */
export async function recalcularPropuesta(
  base: BaseLocal, empresa: { id: string; nit: string }, item: ItemImportacion, retenciones: string[],
): Promise<ItemImportacion> {
  const conceptos = await conceptosRetencion(base, empresa.id, true);
  const propuesta = await propuestaCon(base, empresa, item.documento!, await reglasProveedor(base, empresa.id), conceptos, retenciones);
  return { ...item, propuesta, retenciones };
}

/** Arma la propuesta de un documento con las retenciones indicadas (solo compras) y los parámetros de su año. */
async function propuestaCon(
  base: BaseLocal, empresa: { id: string; nit: string }, d: DocumentoDian, reglas: ReglasProveedor,
  conceptos: readonly ConceptoConfigurado[], codigos: readonly string[],
): Promise<PropuestaAsiento> {
  const anio = Number(d.fechaEmision.slice(0, 4));
  const parametros: ParametrosAnuales = (await parametrosDelAnio(base, anio)) ?? { anio, uvt: 0n };
  const esNota = d.tipo === 'nota_credito';
  const retenciones = conceptos
    .filter((c) => c.aplicaEn === 'compras' && codigos.includes(c.codigo))
    // La base mínima se evalúa sobre la factura original: si a ella se le practicó la retención, la nota
    // crédito reversa la parte proporcional aunque su propio valor no alcance la base.
    .map((c) => (esNota ? { ...c, baseMinimaUvt: '0' } : c));
  const p = proponerAsiento(d, { nitEmpresa: empresa.nit, parametros, reglas, retenciones });
  if (esNota && retenciones.length) {
    p.advertencias.push(`Nota crédito: se reversan las retenciones del proveedor sin base mínima. Verifique que la factura ${d.referencia?.numero ?? 'original'} las tuvo.`);
  }
  if (retenciones.length && parametros.uvt === 0n) {
    p.advertencias.push(`No está configurada la UVT de ${anio}: las bases mínimas de retención no se pudieron verificar.`);
  }
  return p;
}

export async function prepararImportacion(
  base: BaseLocal, empresa: { id: string; nit: string }, archivos: readonly ArchivoEntrada[],
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
  const conceptos = await conceptosRetencion(base, empresa.id, true);
  const yaImportados = new Set((await base.consultar<{ cufe: string }>('select cufe from documentos_dian where empresa_id = ?', [empresa.id])).map((f) => f.cufe));
  const vistos = new Set<string>();
  const items: ItemImportacion[] = [];

  for (const l of leidos) {
    if (!l.documento) {
      items.push({ archivo: l.archivo, estado: 'error', mensaje: l.error ?? 'No se pudo leer.', documento: null, propuesta: null, terceroId: null, retenciones: [] });
      continue;
    }
    const d = l.documento;
    if (d.cufe && (yaImportados.has(d.cufe) || vistos.has(d.cufe))) {
      items.push({ archivo: l.archivo, estado: 'duplicado', mensaje: `El documento ${d.numero} ya fue importado (mismo CUFE).`, documento: d, propuesta: null, terceroId: null, retenciones: [] });
      continue;
    }
    vistos.add(d.cufe);
    let propuesta: PropuestaAsiento;
    let retenciones: string[] = [];
    try {
      const sentido = limpiarNit(d.adquiriente.nit) === limpiarNit(empresa.nit) ? 'compra' : 'venta';
      if (sentido === 'compra') {
        const activos = new Set(conceptos.map((c) => c.codigo));
        retenciones = (await retencionesDeProveedor(base, empresa.id, d.emisor.nit)).filter((c) => activos.has(c));
      }
      propuesta = await propuestaCon(base, empresa, d, reglas, conceptos, retenciones);
    } catch (e) {
      items.push({ archivo: l.archivo, estado: 'ajeno', mensaje: (e as Error).message, documento: d, propuesta: null, terceroId: null, retenciones: [] });
      continue;
    }
    const [t] = await base.consultar<{ id: string }>(
      `select id from terceros where empresa_id = ? and tipo_doc = '31' and numero = ?`, [empresa.id, limpiarNit(propuesta.tercero.nit)]);
    items.push({ archivo: l.archivo, estado: 'nuevo', mensaje: null, documento: d, propuesta, terceroId: t?.id ?? null, retenciones });
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
  /** `cuenta`: solo si el contador cambió la cuenta sugerida. `retencionesCambiadas`: si ajustó las retenciones. */
  seleccion: readonly { item: ItemImportacion; cuenta?: string; retencionesCambiadas?: boolean }[],
): Promise<ResultadoImportacion> {
  const r: ResultadoImportacion = { contabilizados: [], fallidos: [], tercerosCreados: 0, reglasAprendidas: 0 };
  let reglas = await reglasProveedor(base, empresa.id);

  for (const { item, cuenta, retencionesCambiadas } of seleccion) {
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
            // La cuenta y las retenciones elegidas para el proveedor se aprenden y se comparten con los demás PC.
            ...sentenciasAprenderRegla(empresa.id, p.tercero.nit, {
              cuenta: aprender ? cuentaFinal : undefined,
              retenciones: p.sentido === 'compra' && retencionesCambiadas ? item.retenciones : undefined,
            }),
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
