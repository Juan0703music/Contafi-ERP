/** Tema claro/oscuro y "reducir transparencia", como en el prototipo (atributos data-theme y data-glass). */
export type Tema = 'light' | 'dark';

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento: solo esta sesión */ }
}

export function aplicarApariencia(): void {
  const tema = (leer('contafi:tema') as Tema | null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const vidrio = leer('contafi:vidrio') ?? 'on';
  document.documentElement.setAttribute('data-theme', tema);
  document.documentElement.setAttribute('data-glass', vidrio);
}

export function alternarTema(): void {
  const actual = document.documentElement.getAttribute('data-theme');
  guardar('contafi:tema', actual === 'dark' ? 'light' : 'dark');
  aplicarApariencia();
}

export function alternarVidrio(): void {
  const actual = document.documentElement.getAttribute('data-glass');
  guardar('contafi:vidrio', actual === 'off' ? 'on' : 'off');
  aplicarApariencia();
}
