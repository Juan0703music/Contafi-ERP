/**
 * Recorrido de punta a punta del modo demostración en un navegador real (Firefox), con capturas.
 * Uso:  pnpm --filter @contafi/escritorio build && pnpm --filter @contafi/escritorio preview --port 4173
 *       FIREFOX=/usr/bin/firefox PERFIL=~/snap/firefox/common/contafi-e2e pnpm --filter @contafi/escritorio e2e
 * (PERFIL solo hace falta con el Firefox de snap, que no puede usar perfiles en /tmp.)
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const S = new URL('./capturas', import.meta.url).pathname;
mkdirSync(S, { recursive: true });
const URL_APP = process.env.URL_APP ?? 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  browser: 'firefox', executablePath: process.env.FIREFOX ?? '/usr/bin/firefox', headless: true,
  userDataDir: process.env.PERFIL, args: ['--width=1440', '--height=900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errores = [];
const fallas = [];
/** Verificación: si no se cumple, el recorrido termina con error (sirve como prueba automática). */
const verificar = (nombre, ok, valor) => { console.log(`${ok ? '✓' : '✗'} ${nombre}: ${valor}`); if (!ok) fallas.push(nombre); };
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
page.on('pageerror', (e) => errores.push(String(e)));
const foto = async (n) => { await new Promise((r) => setTimeout(r, 400)); await page.screenshot({ path: `${S}/${n}.png` }); console.log('foto', n); };

await page.goto(URL_APP, { waitUntil: 'load' });
await page.waitForSelector('.login-card');
await foto('01-acceso');

await page.goto(`${URL_APP}/?demo`, { waitUntil: 'load' });
await page.waitForSelector('.kpi-grid', { timeout: 20000 });
await foto('02-panel');

await page.click('.nav-item:nth-of-type(1)'); // noop
const ir = async (texto) => { const b = await page.$$('.nav-item'); for (const x of b) { if ((await x.evaluate((n) => n.textContent)).includes(texto)) { await x.click(); break; } } await new Promise((r) => setTimeout(r, 500)); };
await ir('Mis empresas');
await page.waitForSelector('tbody tr');
await new Promise((r) => setTimeout(r, 500));
const misEmpresas = await page.$eval('.page-head p', (n) => n.textContent);
verificar('Panel multi-empresa', misEmpresas.startsWith('2 empresa(s)'), misEmpresas);
await foto('02b-mis-empresas');
await ir('Comprobantes');
await foto('03-comprobantes');

// Nuevo comprobante
const boton = async (texto) => { const b = await page.$$('button'); for (const x of b) { if ((await x.evaluate((n) => n.textContent.trim())) === texto) { await x.click(); return; } } throw new Error('No encontré botón ' + texto); };
await boton('Nuevo comprobante');
await page.waitForSelector('.modal');
await page.type('#cConcepto', 'Papelería y útiles de oficina');
await page.select('select[aria-label="Cuenta línea 1"]', '519530');
await page.type('input[aria-label="Débito línea 1"]', '1.250.000');
await page.select('select[aria-label="Cuenta línea 2"]', '111005');
await page.type('input[aria-label="Crédito línea 2"]', '1.250.000');
await foto('04-nuevo-comprobante');
await boton('Guardar');
await page.waitForSelector('.toast', { timeout: 5000 });
await foto('05-guardado-pendiente');
await new Promise((r) => setTimeout(r, 2500));
await foto('06-sincronizado');

// Autoguardado: escribir, esperar 3,5 s, cerrar y volver a abrir
await boton('Nuevo comprobante');
await page.waitForSelector('#cConcepto');
await page.type('#cConcepto', 'Borrador que no se debe perder');
await new Promise((r) => setTimeout(r, 3600));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
await boton('Nuevo comprobante');
await page.waitForSelector('.modal .notice.info', { timeout: 5000 });
const recuperado = await page.$eval('#cConcepto', (n) => n.value);
verificar('Autoguardado recuperado', recuperado === 'Borrador que no se debe perder', recuperado);
await foto('07-autoguardado');
await page.keyboard.press('Escape');

await ir('Balance de prueba');
await page.waitForSelector('table');
await foto('08-balance');
// Impuestos: UVT y un concepto de retención (VALORES DE EJEMPLO; en la realidad, la norma vigente)
await ir('Impuestos y retenciones');
await page.type('#uValor', '52.374');
await boton('Guardar UVT');
await boton('Nuevo concepto');
await page.waitForSelector('#rCod');
await page.type('#rCod', 'RF-COMPRAS');
await page.type('#rNom', 'Retención en la fuente por compras');
await page.type('#rTar', '2,5');
await page.$eval('#rBase', (n) => { n.value = ''; });
await page.type('#rBase', '10');
await page.select('#rCta', '236540');
await boton('Guardar');
await page.waitForSelector('tbody tr td.mono', { timeout: 5000 });
await foto('07a-impuestos');

// Importación DIAN: subir los XML de ejemplo, cambiar la cuenta de la factura, aplicar la retención y contabilizar
await ir('Importar DIAN');
const fixtures = new URL('../../../packages/dian-xml/test/fixtures/', import.meta.url).pathname;
const archivo = await page.$('input[type=file]');
await archivo.uploadFile(`${fixtures}factura-compra-attached.xml`, `${fixtures}nota-credito.xml`);
await page.waitForSelector('select[aria-label="Cuenta de SN-10457"]', { timeout: 10000 });
await page.select('select[aria-label="Cuenta de SN-10457"]', '519530');
const filaFactura = (await page.$$('tbody tr'))[0];
const casilla = await filaFactura.$('label.hint input[type=checkbox]');
await casilla.click();
await new Promise((r) => setTimeout(r, 600));
const retencion = await filaFactura.$eval('label.hint', (n) => n.textContent.trim());
verificar('Retención aplicada', retencion.includes('26.500'), retencion);
await foto('07b-importar-dian');
const botonImportar = await page.$$('button');
for (const b of botonImportar) { if ((await b.evaluate((n) => n.textContent)).includes('Contabilizar 2')) { await b.click(); break; } }
await page.waitForSelector('.page-head h1', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 2500));
const filasFC = await page.$$eval('tbody tr', (trs) => trs.map((t) => t.textContent).filter((t) => /FC-|NC-/.test(t)));
const importados = filasFC.map((t) => t.match(/(FC|NC)-\d{6}/)?.[0]).filter(Boolean);
verificar('Importados con número oficial', importados.includes('NC-000001') && importados.includes('FC-000002'), importados.join(', '));
await foto('07c-importados');

// Conciliación bancaria: extracto de marzo contra libros (antes de cerrar marzo)
await ir('Conciliación bancaria');
await boton('Cargar extracto');
await page.waitForSelector('#bCta');
await page.select('#bCta', '111005');
await (await page.$('#bArch')).uploadFile(new URL('./extracto-marzo.csv', import.meta.url).pathname);
await page.waitForSelector('#bSaldo', { timeout: 5000 });
await page.type('#bSaldo', '55.568.000');
await boton('Cargar');
await page.waitForSelector('.kpi-grid', { timeout: 5000 });
await boton('Conciliar automáticamente');
await new Promise((r) => setTimeout(r, 600));
const filasBanco = await page.$$('.grid2 .panel:first-child tbody tr');
for (const f of filasBanco) {
  if ((await f.evaluate((n) => n.textContent)).includes('Comisión')) { const b = await f.$('button'); await b.click(); break; }
}
await page.waitForSelector('#rgCta');
await boton('Crear comprobante');
await new Promise((r) => setTimeout(r, 900));
const conciliacion = await page.$eval('.notice b', (n) => n.textContent);
verificar('Conciliación bancaria', conciliacion.includes('cuadrada'), conciliacion);
await foto('07f-conciliacion');

// Períodos y cierres: cerrar marzo en el modo demostración
await ir('Períodos y cierres');
await page.waitForSelector('tbody tr');
const filasMes = await page.$$('tbody tr');
for (const f of filasMes) {
  if ((await f.evaluate((n) => n.textContent)).startsWith('Marzo')) { const b = await f.$('button'); await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 800));
const marzo = await page.$$eval('tbody tr', (trs) => trs.find((t) => t.textContent.startsWith('Marzo'))?.textContent);
verificar('Marzo cerrado', marzo.includes('Cerrado'), marzo.includes('Cerrado') ? 'Cerrado' : marzo);
await foto('07d-cierres');

// Saldos iniciales desde CSV
await ir('Saldos iniciales');
const csv = await page.$('#sArchivo');
await csv.uploadFile(new URL('./saldos-ejemplo.csv', import.meta.url).pathname);
await page.waitForSelector('.fila-total', { timeout: 5000 });
const saldos = await page.$eval('.balance-ok, .balance-bad', (n) => n.textContent);
verificar('Saldos iniciales', saldos === 'Balanceado', saldos);
await foto('07e-saldos-iniciales');

await ir('Libros');
await page.waitForSelector('table');
await foto('08b-libro-diario');
await boton('Mayor y balances');
await foto('08c-mayor');
await boton('Excel'); // no debe producir errores
await ir('Estados financieros');
await page.waitForSelector('table');
const desdeInicio = await page.$('#eCorte');
await foto('08d-situacion-financiera');
const cuadra = await page.$eval('.balance-ok, .balance-bad', (n) => n.textContent);
verificar('Estado de situación financiera', cuadra === 'Activo = Pasivo + Patrimonio', cuadra);
await page.pdf({ path: `${S}/estado-situacion.pdf`, format: 'letter', printBackground: false });
await boton('Resultados');
await foto('08e-resultados');
await ir('Terceros');
await foto('09-terceros');
await boton('Nuevo tercero');
await page.waitForSelector('#tNum');
await page.type('#tNum', '800197268');
await page.type('#tNombre', 'DIAN');
await foto('09b-nuevo-tercero');
await page.keyboard.press('Escape');
await ir('Plan de cuentas');
await foto('10-cuentas');
await ir('Sincronización');
await foto('11-sincronizacion');

// Tema oscuro y sin transparencia
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await ir('Panel');
await foto('12-panel-oscuro');
await page.evaluate(() => { document.documentElement.setAttribute('data-glass', 'off'); });
await foto('13-oscuro-sin-vidrio');
// Móvil / ventana angosta
await page.setViewport({ width: 390, height: 844 });
await foto('14-angosto');

console.log('ERRORES DE CONSOLA:', errores.length ? errores : 'ninguno');
await browser.close();
if (errores.length || fallas.length) { console.log('FALLARON:', fallas); process.exit(1); }
