import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ErrorAcceso, ErrorSuscripcion } from '@contafi/sync';

/** Vercel limita el cuerpo a ~4,5 MB; se corta antes con un mensaje claro (la app debe partir el lote). */
export const MAX_CUERPO = 4 * 1024 * 1024;

export class ErrorHttp extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

/** Token de la sesión del usuario (Supabase Auth). La API no usa llaves de servicio. */
export function tokenDe(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new ErrorHttp(401, 'SIN_SESION', 'Falta el encabezado Authorization: Bearer <token de sesión>.');
  return m[1]!;
}

export async function leerJson(req: Request): Promise<unknown> {
  const largo = Number(req.headers.get('content-length') ?? '0');
  if (largo > MAX_CUERPO) throw new ErrorHttp(413, 'LOTE_MUY_GRANDE', 'El envío supera 4 MB: divida el lote.');
  const texto = await req.text();
  if (texto.length > MAX_CUERPO) throw new ErrorHttp(413, 'LOTE_MUY_GRANDE', 'El envío supera 4 MB: divida el lote.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorHttp(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
  }
}

export const ok = (datos: unknown, estado = 200) =>
  NextResponse.json(datos, { status: estado, headers: { 'Cache-Control': 'no-store' } });

/** Traduce cualquier error a una respuesta JSON sin filtrar detalles internos. */
export function responderError(e: unknown): NextResponse {
  if (e instanceof ErrorHttp) return ok({ error: e.codigo, mensaje: e.message }, e.estado);
  if (e instanceof ZodError) {
    return ok({ error: 'DATOS_INVALIDOS', mensaje: 'La solicitud no cumple el protocolo.', detalle: e.issues.slice(0, 20) }, 400);
  }
  if (e instanceof ErrorSuscripcion) return ok({ error: 'SUSCRIPCION_VENCIDA', mensaje: e.message }, 402);
  if (e instanceof ErrorAcceso) return ok({ error: 'SIN_PERMISO', mensaje: e.message }, 403);
  console.error(e);
  return ok({ error: 'ERROR_INTERNO', mensaje: 'Error inesperado. Intente de nuevo; si persiste, contacte a soporte.' }, 500);
}
