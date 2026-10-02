/**
 * Recorrido de punta a punta del modo demostración en un navegador real (Firefox), con capturas.
 * Uso:  pnpm --filter @contafi/escritorio build && pnpm --filter @contafi/escritorio preview --port 4173
 *       FIREFOX=/usr/bin/firefox PERFIL=~/snap/firefox/common/contafi-e2e pnpm --filter @contafi/escritorio e2e
 * (PERFIL solo hace falta con el Firefox de snap, que no puede usar perfiles en /tmp.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
const boton = async (texto) => { const b = await page.$$('button'); for (const x of b) { if ((await x.evaluate((n) => n.textContent.trim())) === texto) { await x.click(); return; } } throw new Error('No encontré botón ' + texto); };
const ir = async (texto) => { const b = await page.$$('.nav-item'); for (const x of b) { if ((await x.evaluate((n) => n.textContent)).includes(texto)) { await x.click(); break; } } await new Promise((r) => setTimeout(r, 500)); };
await ir('Mis empresas');
await page.waitForSelector('tbody tr');
await new Promise((r) => setTimeout(r, 500));
const misEmpresas = await page.$eval('.page-head p', (n) => n.textContent);
verificar('Panel multi-empresa', misEmpresas.startsWith('2 empresa(s)'), misEmpresas);
await foto('02b-mis-empresas');
// Jarvis (en el navegador: asistente por reglas, con cifras del motor)
await ir('Jarvis');
await page.waitForSelector('.suggest-chip');
const chips = await page.$$('.suggest-chip');
await chips[0].click();
await page.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 2, { timeout: 15000 });
const respuestaJarvis = await page.$$eval('.msg.bot', (ms) => ms.at(-1).textContent);
verificar('Jarvis responde con cifras del motor', /\$ [\d.]+/.test(respuestaJarvis) && respuestaJarvis.includes('Cifras del motor'), respuestaJarvis.slice(0, 90));
await foto('02c-jarvis');
// Doble corrida (piloto): balance "del otro software" al 31 de enero, a distintos niveles del PUC
const anioE2e = new Date().getFullYear();
const csvOtro = `${S}/balance-otro-software.csv`;
writeFileSync(csvOtro, ['Código;Nombre de la cuenta;Saldo final', 'ACTIVO;;', '1105;Caja;5.000.000', '111005;Bancos nacionales;50.000.000',
  '1435;Mercancías;18.000.000', '240810;IVA descontable;3.420.000', '220505;Proveedores nacionales;20.970.000',
  '236540;Retención en compras;450.000', '31;Capital social;55.000.000', 'TOTALES;;'].join('\n'));
await ir('Doble corrida');
await page.waitForSelector('#dCorte');
await page.$eval('#dCorte', (n, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); }, `${anioE2e}-01-31`);
await (await page.$('#dArchivo')).uploadFile(csvOtro);
await page.waitForSelector('.balance-ok, .balance-bad', { timeout: 5000 });
const dobleCorrida = await page.$eval('.balance-ok, .balance-bad', (n) => n.textContent);
await foto('02d-doble-corrida');
verificar('Doble corrida sin diferencias', dobleCorrida === 'Cero diferencias en 7 cuentas comparadas', dobleCorrida);
// Ventas y compras: factura de venta manual, cartera y recaudo parcial
await ir('Ventas y compras');
await boton('Factura de venta');
await page.waitForSelector('#fTer');
const opcionesTercero = await page.$$eval('#fTer option', (os) => os.map((o) => [o.value, o.textContent]));
await page.select('#fTer', opcionesTercero.find(([, t]) => t.includes('El Roble'))[0]);
await page.type('#fNum', 'FE-2001');
await page.type('input[aria-label="Descripción ítem 1"]', 'Instalación de red');
await page.type('input[aria-label="Valor ítem 1"]', '1.000.000');
await page.waitForSelector('.modal .total-bar', { timeout: 5000 });
await foto('02d-factura-venta');
await boton('Guardar');
await page.waitForSelector('tbody tr', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 500));
const filaRoble = (await page.$$('tbody tr'))[0];
const saldoRoble = await filaRoble.$eval('td:nth-child(2)', (n) => n.textContent);
verificar('Cartera con la factura nueva', saldoRoble === '$ 1.190.000', saldoRoble);
await (await filaRoble.$('button')).click();
await page.waitForSelector('#mValor');
await page.$eval('#mValor', (n) => { n.value = ''; });
await page.type('#mValor', '190.000');
await boton('Registrar');
await new Promise((r) => setTimeout(r, 700));
const saldoTrasRecaudo = await page.$eval('tbody tr td:nth-child(2)', (n) => n.textContent);
verificar('Recaudo parcial descuenta la cartera', saldoTrasRecaudo === '$ 1.000.000', saldoTrasRecaudo);
await foto('02e-cartera');

// Inventario: producto nuevo, compra de 10 a $ 180.000 y venta de 2 → quedan 8 por $ 1.440.000
await ir('Inventario');
await boton('Nuevo producto');
await page.waitForSelector('#pCod');
await page.type('#pCod', 'RT-100');
await page.type('#pNom', 'Router empresarial');
await page.type('#pPre', '295.000');
await boton('Guardar');
await new Promise((r) => setTimeout(r, 500));
const facturarProducto = async (tipo, tercero, numero, cantidad, valor) => {
  await ir('Ventas y compras');
  await boton(tipo);
  await page.waitForSelector('#fTer');
  const ops = await page.$$eval('#fTer option', (os) => os.map((o) => [o.value, o.textContent]));
  await page.select('#fTer', ops.find(([, t]) => t.includes(tercero))[0]);
  await page.type('#fNum', numero);
  const prods = await page.$$eval('select[aria-label="Producto ítem 1"] option', (os) => os.map((o) => [o.value, o.textContent]));
  await page.select('select[aria-label="Producto ítem 1"]', prods.find(([, t]) => t.includes('RT-100'))[0]);
  await page.$eval('input[aria-label="Cantidad ítem 1"]', (n) => { n.value = ''; });
  await page.type('input[aria-label="Cantidad ítem 1"]', cantidad);
  if (valor) { await page.$eval('input[aria-label="Valor ítem 1"]', (n) => { n.value = ''; }); await page.type('input[aria-label="Valor ítem 1"]', valor); }
  await page.waitForSelector('.modal .total-bar', { timeout: 5000 });
  await boton('Guardar');
  await new Promise((r) => setTimeout(r, 700));
};
await facturarProducto('Factura de compra', 'Suministros del Norte', 'SN-777', '10', '180.000');
await facturarProducto('Factura de venta', 'El Roble', 'FE-2002', '2', null);
await ir('Inventario');
await page.waitForSelector('tbody tr');
const filaInv = await page.$$eval('tbody tr', (trs) => trs.find((t) => t.textContent.includes('RT-100'))?.textContent ?? '');
verificar('Kárdex por costo promedio', filaInv.includes('8 UND') && filaInv.includes('$ 1.440.000') && filaInv.includes('$ 180.000'), filaInv.replace(/\s+/g, ' ').slice(0, 120));
await foto('02f-inventario');
await ir('Comprobantes');
await foto('03-comprobantes');

// Nuevo comprobante
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

// Calendario tributario: fechas de PRUEBA relativas a hoy (el NIT de Andina termina en 6)
const enDias = (n) => { const f = new Date(Date.now() + n * 86_400_000); return `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}/${f.getFullYear()}`; };
const csvCalendario = `${S}/calendario-e2e.csv`;
writeFileSync(csvCalendario, ['obligacion;nombre;periodo;ultimo_digito_nit;fecha', `RETENCION;Retención en la fuente;P1;6;${enDias(3)}`,
  `RETENCION;Retención en la fuente;P1;7;${enDias(4)}`, `IVA_BIM;IVA bimestral;B5;6;${enDias(20)}`, `RENTA;Renta;2025;6;${enDias(10)}`].join('\n'));
await page.$eval('#cAnio', (n, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); },
  String(new Date(Date.now() + 3 * 86_400_000).getFullYear()));
await (await page.$('#cArchivo')).uploadFile(csvCalendario);
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('Guardar calendario') && !b.disabled), { timeout: 5000 });
const guardarCal = await page.$$('button');
for (const b of guardarCal) if ((await b.evaluate((n) => n.textContent)).startsWith('Guardar calendario')) { await b.click(); break; }
await page.waitForSelector('input[aria-label="Obligación RETENCION"]', { timeout: 5000 });
await page.click('input[aria-label="Obligación RETENCION"]');
await page.click('input[aria-label="Obligación IVA_BIM"]');
await boton('Guardar obligaciones');
await new Promise((r) => setTimeout(r, 800));
await foto('07a2-calendario');
await ir('Panel');
await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Próximos vencimientos'), { timeout: 5000 });
const venc = await page.$$eval('.panel', (ps) => ps.find((p) => p.querySelector('h2')?.textContent === 'Próximos vencimientos').querySelectorAll('tbody tr').length);
verificar('Vencimientos del calendario tributario', venc === 2, `${venc} vencimiento(s) para el NIT terminado en 6 (retención en 3 días, IVA en 20)`);
await foto('07a3-panel-vencimientos');

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
// Auxiliar de impuestos del año (IVA y retenciones con su base)
await boton('Impuestos');
await page.evaluate(() => {
  const i = document.querySelector('#lDesde');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(i, `${new Date().getFullYear()}-01-01`);
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => document.querySelectorAll('.kpi-card').length === 3, { timeout: 5000 });
const ivaKpis = await page.$$eval('.kpi-card', (ks) => ks.map((k) => k.textContent));
await foto('08c2-auxiliar-impuestos');
// Incluye el IVA de la factura FE-1001 de febrero (4.750.000) y el de la venta del recorrido.
const generado = Number(ivaKpis[0].replace(/\D/g, ''));
verificar('Auxiliar de impuestos', ivaKpis[0].startsWith('IVA generado') && generado >= 4_940_000, ivaKpis.join(' · '));
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
// Importación masiva de terceros desde CSV (uno ya existe en la demostración)
await boton('Importar CSV');
await (await page.waitForSelector('#iArchivo')).uploadFile(new URL('./terceros-ejemplo.csv', import.meta.url).pathname);
await page.waitForSelector('.modal tbody tr');
await boton('Importar 3 tercero(s)');
await page.waitForSelector('.modal .notice');
const omitidos = await page.$eval('.modal .notice', (n) => n.textContent);
await foto('09c-importar-terceros');
await page.keyboard.press('Escape');
await page.type('input[aria-label="Buscar tercero"]', 'Davivienda');
await new Promise((r) => setTimeout(r, 600));
const importado = await page.$eval('tbody tr', (n) => n.textContent);
verificar('Importación de terceros', importado.includes('860034313-7') && omitidos.includes('El Roble'), importado);
// Editar: responsabilidades fiscales del RUT
await page.click('button[aria-label="Editar Banco Davivienda S.A."]');
await page.waitForSelector('#tMunicipio');
await page.click('input[aria-label^="O-13"]');
await page.click('input[aria-label^="O-23"]');
await foto('09d-editar-tercero');
await boton('Guardar');
await new Promise((r) => setTimeout(r, 800));
const editado = await page.$eval('tbody tr', (n) => n.textContent);
verificar('Responsabilidades fiscales', editado.includes('O-13 O-23'), editado);
await ir('Plan de cuentas');
await foto('10-cuentas');
// PUC personalizable: auxiliar bajo 112005; el padre deja de ser auxiliar
await page.click('button[aria-label="Subcuenta de 112005"]');
await page.waitForSelector('#cCodigo');
await page.type('#cCodigo', '01');
await page.type('#cNombre', 'Davivienda ahorros 9981');
await foto('10b-nueva-cuenta');
await boton('Guardar');
await new Promise((r) => setTimeout(r, 1500));
await page.type('input[aria-label="Buscar cuenta"]', '112005');
await new Promise((r) => setTimeout(r, 500));
const filasPuc = await page.$$eval('tbody tr', (trs) => trs.map((t) => t.textContent));
verificar('Cuenta auxiliar creada', filasPuc.length === 2 && filasPuc[0].includes('Mayor') && filasPuc[1].includes('11200501') && filasPuc[1].includes('Auxiliar'), filasPuc.join(' | '));
await ir('Sincronización');
await foto('11-sincronizacion');

// Equipo de la firma (simulado en la demostración): invitar con rol por empresa y cambiar accesos
await ir('Equipo de la firma');
await page.waitForSelector('tbody tr');
await boton('Invitar');
await page.waitForSelector('#iCorreo');
await page.type('#iCorreo', 'sofia.rios@ejemplo.co');
const selRoles = await page.$$('.modal select[aria-label^="Rol en"]');
await selRoles[0].select('Contador');
await boton('Enviar invitación');
await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Invitaciones pendientes'), { timeout: 5000 });
await page.click('button[aria-label="Accesos de Jorge Peña"]');
await page.waitForSelector('#aRol');
const selJorge = await page.$$('.modal select[aria-label^="Rol en"]');
await selJorge[1].select('Tesorero');
await boton('Guardar');
await new Promise((r) => setTimeout(r, 600));
const equipoTexto = await page.$eval('.main', (n) => n.textContent);
verificar('Equipo de la firma', equipoTexto.includes('sofia.rios@ejemplo.co') && /Panadería La Espiga S\.A\.S\.: Tesorero/.test(equipoTexto), 'invitación pendiente y Jorge como tesorero en La Espiga');
await foto('11b-equipo');

// Alta de una empresa nueva desde "Mis empresas"
await ir('Mis empresas');
await boton('Nueva empresa');
await page.waitForSelector('#eNit');
await page.type('#eNit', '900.555.777');
await page.type('#eRazon', 'Ferretería El Tornillo S.A.S.');
await foto('11c-nueva-empresa');
await boton('Crear empresa');
await page.waitForFunction(() => document.querySelector('.page-head h1')?.textContent === 'Saldos iniciales', { timeout: 5000 });
const empresaActiva = await page.$eval('select[aria-label="Empresa"]', (s) => s.selectedOptions[0].textContent);
const nitNuevo = await page.$eval('.company-chip .sub', (n) => n.textContent);
verificar('Empresa nueva', empresaActiva === 'Ferretería El Tornillo S.A.S.' && nitNuevo === 'NIT 900555777-0', `${empresaActiva} · ${nitNuevo}`);

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
