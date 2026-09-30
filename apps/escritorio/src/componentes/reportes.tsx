import type { ReactNode } from 'react';
import writeXlsxFile from 'write-excel-file/browser';
import type { Centavos } from '@contafi/shared';
import { useApp } from '../estado.tsx';
import { Icono } from './comunes.tsx';

export type CeldaExcel = string | number | null;

/** Excel no maneja centavos exactos: se exporta en pesos con dos decimales (hasta 15 dígitos, sin pérdida). */
export const aPesos = (c: Centavos): number => Number(c) / 100;

export async function exportarExcel(archivo: string, hoja: string, encabezados: string[], filas: CeldaExcel[][]): Promise<void> {
  const datos = [
    encabezados.map((e) => ({ value: e, fontWeight: 'bold' as const })),
    ...filas.map((f) => f.map((v) => (typeof v === 'number' ? { value: v, type: Number, format: '#,##0.00' } : v ?? null))),
  ];
  await writeXlsxFile(datos, { sheet: hoja.slice(0, 31), columns: encabezados.map((_, i) => ({ width: i === 1 ? 42 : 18 })) }).toFile(`${archivo}.xlsx`);
}

export function Pestanas<T extends string>({ opciones, valor, cambiar, etiqueta }: {
  opciones: [T, string][]; valor: T; cambiar: (v: T) => void; etiqueta: string;
}) {
  return (
    <div className="seg" role="group" aria-label={etiqueta}>
      {opciones.map(([v, t]) => <button key={v} type="button" aria-pressed={valor === v} onClick={() => cambiar(v)}>{t}</button>)}
    </div>
  );
}

/** Encabezado que solo aparece al imprimir (o guardar como PDF): empresa, NIT, reporte y período. */
export function EncabezadoImpresion({ titulo, periodo }: { titulo: string; periodo: string }) {
  const { empresa } = useApp();
  return (
    <div className="solo-impresion encabezado-reporte">
      <b>{empresa.razon_social}</b> · NIT {empresa.nit}{empresa.dv != null ? `-${empresa.dv}` : ''}<br />
      <b>{titulo}</b> · {periodo}
    </div>
  );
}

export function BotonesReporte({ alExportar, extra }: { alExportar: () => Promise<void>; extra?: ReactNode }) {
  const { avisar } = useApp();
  return (
    <div className="btn-row no-imprimir">
      {extra}
      <button className="btn" onClick={() => alExportar().catch((e: Error) => avisar(`No se pudo exportar: ${e.message}`, 'danger'))}>
        <Icono nombre="file" />Excel
      </button>
      <button className="btn" onClick={() => window.print()}><Icono nombre="printer" />Imprimir / PDF</button>
    </div>
  );
}
