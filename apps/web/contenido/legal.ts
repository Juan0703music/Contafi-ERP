/**
 * Textos legales (checklist de lanzamiento). Los redacta y aprueba el abogado; mientras tanto la página dice
 * que están en preparación. Al publicarlos: poner aquí el texto, la misma versión que en la tabla
 * documentos_legales del servidor, y marcar allá publicado = true (la app pedirá aceptarlos).
 */
export interface TextoLegal { version: string; vigenteDesde: string; parrafos: string[] }

export const TERMINOS: TextoLegal | null = null;
export const PRIVACIDAD: TextoLegal | null = null;
