import type { BaseLocal } from './base.ts';
import { versionEsquema } from './esquema.ts';

/**
 * Diagnóstico para soporte (Fase 6: medir la sincronización y la carga de soporte). Solo datos técnicos:
 * cantidades, estados y errores de la cola. NUNCA montos, nombres de terceros ni conceptos.
 */
export interface Diagnostico {
  esquema: number;
  metricas: { sincronizaciones: number; operaciones: number; rechazos: number; fallos: number; desde: string | null; ultimoFallo: string | null };
  /** Errores (rechazos + fallos de red) por cada 1.000 operaciones; null si aún no hay operaciones. */
  erroresPorMil: number | null;
  cola: { tipo: string; cantidad: number; maxIntentos: number; ultimoError: string | null }[];
  comprobantes: Record<string, number>;
  maestros: { cuentas: number; terceros: number; productos: number };
  ultimoEnvio: string | null;
  ultimaRecepcion: string | null;
}

export async function diagnosticoLocal(base: BaseLocal, empresa: string): Promise<Diagnostico> {
  const n = async (sql: string) => Number((await base.consultar<{ n: number }>(sql, [empresa]))[0]?.n ?? 0);
  const [m] = await base.consultar<Record<string, number | string | null>>('select * from metricas_sync where empresa_id = ?', [empresa]);
  const cola = await base.consultar<{ tipo: string; cantidad: number; max_intentos: number; ultimo_error: string | null }>(
    `select tipo, count(*) as cantidad, max(intentos) as max_intentos,
            (select ultimo_error from cola_salida c2 where c2.empresa_id = c.empresa_id and c2.tipo = c.tipo and c2.ultimo_error is not null order by seq desc limit 1) as ultimo_error
       from cola_salida c where empresa_id = ? group by tipo order by tipo`, [empresa]);
  const estados = await base.consultar<{ estado: string; n: number }>('select estado, count(*) as n from comprobantes where empresa_id = ? group by estado', [empresa]);
  const [e] = await base.consultar<{ ultimo_envio: string | null; ultima_recepcion: string | null }>(
    'select ultimo_envio, ultima_recepcion from estado_sync where empresa_id = ?', [empresa]);
  const metricas = {
    sincronizaciones: Number(m?.['sincronizaciones'] ?? 0), operaciones: Number(m?.['operaciones'] ?? 0),
    rechazos: Number(m?.['rechazos'] ?? 0), fallos: Number(m?.['fallos'] ?? 0),
    desde: (m?.['desde'] as string | null) ?? null, ultimoFallo: (m?.['ultimo_fallo'] as string | null) ?? null,
  };
  return {
    esquema: await versionEsquema(base),
    metricas,
    erroresPorMil: metricas.operaciones ? Math.round(((metricas.rechazos + metricas.fallos) / metricas.operaciones) * 10_000) / 10 : null,
    cola: cola.map((c) => ({ tipo: c.tipo, cantidad: Number(c.cantidad), maxIntentos: Number(c.max_intentos), ultimoError: c.ultimo_error })),
    comprobantes: Object.fromEntries(estados.map((x) => [x.estado, Number(x.n)])),
    maestros: {
      cuentas: await n('select count(*) as n from cuentas where empresa_id = ?'),
      terceros: await n('select count(*) as n from terceros where empresa_id = ?'),
      productos: await n('select count(*) as n from productos where empresa_id = ?'),
    },
    ultimoEnvio: e?.ultimo_envio ?? null,
    ultimaRecepcion: e?.ultima_recepcion ?? null,
  };
}

/** Texto para pegar en WhatsApp o en el correo de soporte. */
export function textoDiagnostico(d: Diagnostico, entorno: { app: string; sistema: string; modo: string; nit: string; dispositivo: string }): string {
  const lineas = [
    `Diagnóstico de Contafi ${entorno.app} (${entorno.modo})`,
    `Equipo: ${entorno.sistema} · dispositivo ${entorno.dispositivo.slice(0, 8)} · base local v${d.esquema}`,
    `Empresa: NIT ${entorno.nit}`,
    `Último envío: ${d.ultimoEnvio ?? 'nunca'} · última recepción: ${d.ultimaRecepcion ?? 'nunca'}`,
    `Sincronizaciones: ${d.metricas.sincronizaciones} desde ${d.metricas.desde ?? '—'} · operaciones ${d.metricas.operaciones} · rechazos ${d.metricas.rechazos} · fallos de red ${d.metricas.fallos}`
      + (d.erroresPorMil === null ? '' : ` · ${d.erroresPorMil} errores por cada 1.000 operaciones`),
    d.metricas.ultimoFallo ? `Último fallo: ${d.metricas.ultimoFallo}` : 'Último fallo: ninguno',
    d.cola.length
      ? `Pendientes: ${d.cola.map((c) => `${c.tipo} ${c.cantidad} (máx. ${c.maxIntentos} intentos${c.ultimoError ? `; error: ${c.ultimoError.slice(0, 120)}` : ''})`).join(' · ')}`
      : 'Pendientes: ninguno',
    `Comprobantes: ${Object.entries(d.comprobantes).map(([k, v]) => `${k} ${v}`).join(' · ') || 'ninguno'}`,
    `Maestros: ${d.maestros.cuentas} cuentas · ${d.maestros.terceros} terceros · ${d.maestros.productos} productos`,
  ];
  return lineas.join('\n');
}
