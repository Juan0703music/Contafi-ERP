/**
 * Plan Único de Cuentas (Decreto 2650 de 1993) — plantilla semilla para comerciantes.
 * Es solo una plantilla: cada empresa la personaliza. El contador asesor debe validarla.
 *
 * Corrección frente al prototipo: el prototipo usaba 135515 como "IVA descontable".
 * En el PUC, 135515 es "Retención en la fuente" (anticipo de impuestos). El IVA descontable
 * se lleva en la subcuenta 240810 (dentro de 2408, con naturaleza débito).
 */
export type Naturaleza = 'D' | 'C';

export interface CuentaPlantilla {
  codigo: string;
  nombre: string;
  naturaleza: Naturaleza;
  exigeTercero: boolean;
}

/** Nivel PUC según la longitud del código: 1 clase, 2 grupo, 4 cuenta, 6 subcuenta, 8+ auxiliar. */
export function nivelPuc(codigo: string): 1 | 2 | 3 | 4 | 5 {
  switch (codigo.length) {
    case 1: return 1;
    case 2: return 2;
    case 4: return 3;
    case 6: return 4;
    default:
      if (codigo.length >= 8) return 5;
      throw new RangeError(`Código PUC inválido: "${codigo}"`);
  }
}

/**
 * Por qué no se puede crear una cuenta con ese código, o null si se puede. Clases y grupos los fija el
 * PUC (Decreto 2650 de 1993); las empresas crean cuentas (4 dígitos), subcuentas (6) y auxiliares (8, 10 o 12).
 * El servidor aplica la misma regla en registrar_cuenta.
 */
export function errorCodigoCuentaNueva(codigo: string): string | null {
  if (!/^[1-9][0-9]*$/.test(codigo) || ![4, 6, 8, 10, 12].includes(codigo.length)) {
    return 'El código debe tener 4, 6, 8, 10 o 12 dígitos (las clases y los grupos los fija el PUC).';
  }
  return null;
}

/** Código del padre inmediato ("110505" -> "1105"). */
export function codigoPadre(codigo: string): string | null {
  switch (codigo.length) {
    case 1: return null;
    case 2: return codigo.slice(0, 1);
    case 4: return codigo.slice(0, 2);
    case 6: return codigo.slice(0, 4);
    default: return codigo.slice(0, codigo.length - 2);
  }
}

const c = (codigo: string, nombre: string, naturaleza: Naturaleza, exigeTercero = false): CuentaPlantilla =>
  ({ codigo, nombre, naturaleza, exigeTercero });

export const PUC_SEMILLA: readonly CuentaPlantilla[] = [
  c('1', 'ACTIVO', 'D'),
  c('11', 'Disponible', 'D'),
  c('1105', 'Caja', 'D'),
  c('110505', 'Caja general', 'D'),
  c('110510', 'Cajas menores', 'D'),
  c('1110', 'Bancos', 'D'),
  c('111005', 'Bancos nacionales', 'D'),
  c('1120', 'Cuentas de ahorro', 'D'),
  c('112005', 'Bancos — cuentas de ahorro', 'D'),
  c('13', 'Deudores', 'D'),
  c('1305', 'Clientes', 'D'),
  c('130505', 'Clientes nacionales', 'D', true),
  c('1330', 'Anticipos y avances', 'D'),
  c('133005', 'Anticipos a proveedores', 'D', true),
  c('1355', 'Anticipo de impuestos y contribuciones o saldos a favor', 'D'),
  c('135515', 'Retención en la fuente', 'D', true),
  c('135517', 'Impuesto a las ventas retenido', 'D', true),
  c('135518', 'Impuesto de industria y comercio retenido', 'D', true),
  c('14', 'Inventarios', 'D'),
  c('1435', 'Mercancías no fabricadas por la empresa', 'D'),
  c('143505', 'Mercancías no fabricadas por la empresa', 'D'),
  c('15', 'Propiedades, planta y equipo', 'D'),
  c('1524', 'Equipo de oficina', 'D'),
  c('152405', 'Muebles y enseres', 'D'),
  c('1528', 'Equipo de computación y comunicación', 'D'),
  c('152805', 'Equipos de procesamiento de datos', 'D'),
  c('1592', 'Depreciación acumulada', 'C'),
  c('159215', 'Equipo de oficina', 'C'),
  c('159220', 'Equipo de computación y comunicación', 'C'),

  c('2', 'PASIVO', 'C'),
  c('21', 'Obligaciones financieras', 'C'),
  c('2105', 'Bancos nacionales', 'C'),
  c('210505', 'Sobregiros', 'C', true),
  c('22', 'Proveedores', 'C'),
  c('2205', 'Nacionales', 'C'),
  c('220505', 'Proveedores nacionales', 'C', true),
  c('23', 'Cuentas por pagar', 'C'),
  c('2335', 'Costos y gastos por pagar', 'C'),
  c('233595', 'Otros costos y gastos por pagar', 'C', true),
  c('2365', 'Retención en la fuente', 'C'),
  c('236515', 'Honorarios', 'C', true),
  c('236525', 'Servicios', 'C', true),
  c('236530', 'Arrendamientos', 'C', true),
  c('236540', 'Compras', 'C', true),
  c('2367', 'Impuesto a las ventas retenido', 'C'),
  c('236701', 'IVA retenido', 'C', true),
  c('2368', 'Impuesto de industria y comercio retenido', 'C'),
  c('236801', 'ICA retenido', 'C', true),
  c('24', 'Impuestos, gravámenes y tasas', 'C'),
  c('2404', 'De renta y complementarios', 'C'),
  c('240405', 'Vigencia fiscal corriente', 'C'),
  c('2408', 'Impuesto sobre las ventas por pagar', 'C'),
  c('240805', 'IVA generado', 'C'),
  c('240810', 'IVA descontable', 'D'),
  c('2412', 'De industria y comercio', 'C'),
  c('241205', 'Vigencia fiscal corriente', 'C'),
  c('2495', 'Otros', 'C'),
  c('249505', 'Impuesto nacional al consumo', 'C'),
  c('25', 'Obligaciones laborales', 'C'),
  c('2505', 'Salarios por pagar', 'C'),
  c('250505', 'Salarios por pagar', 'C', true),
  c('2510', 'Cesantías consolidadas', 'C'),
  c('251010', 'Cesantías consolidadas', 'C', true),
  c('27', 'Diferidos', 'C'),
  c('2705', 'Ingresos recibidos por anticipado', 'C'),
  c('270505', 'Ingresos recibidos por anticipado', 'C', true),
  c('28', 'Otros pasivos', 'C'),
  c('2805', 'Anticipos y avances recibidos', 'C'),
  c('280505', 'De clientes', 'C', true),

  c('3', 'PATRIMONIO', 'C'),
  c('31', 'Capital social', 'C'),
  c('3105', 'Capital suscrito y pagado', 'C'),
  c('310505', 'Capital autorizado', 'C'),
  c('36', 'Resultados del ejercicio', 'C'),
  c('3605', 'Utilidad del ejercicio', 'C'),
  c('360505', 'Utilidad del ejercicio', 'C'),
  c('3610', 'Pérdida del ejercicio', 'D'),
  c('361005', 'Pérdida del ejercicio', 'D'),
  c('37', 'Resultados de ejercicios anteriores', 'C'),
  c('3705', 'Utilidades acumuladas', 'C'),
  c('370505', 'Utilidades acumuladas', 'C'),
  c('3710', 'Pérdidas acumuladas', 'D'),
  c('371005', 'Pérdidas acumuladas', 'D'),

  c('4', 'INGRESOS', 'C'),
  c('41', 'Operacionales', 'C'),
  c('4135', 'Comercio al por mayor y al por menor', 'C'),
  c('413595', 'Venta de otros productos', 'C'),
  c('4155', 'Actividades inmobiliarias, empresariales y de alquiler', 'C'),
  c('415595', 'Otras actividades de servicios', 'C'),
  c('4175', 'Devoluciones en ventas (DB)', 'D'),
  c('417505', 'Devoluciones en ventas', 'D'),
  c('42', 'No operacionales', 'C'),
  c('4210', 'Financieros', 'C'),
  c('421005', 'Intereses', 'C'),

  c('5', 'GASTOS', 'D'),
  c('51', 'Operacionales de administración', 'D'),
  c('5105', 'Gastos de personal', 'D'),
  c('510506', 'Sueldos', 'D'),
  c('5110', 'Honorarios', 'D'),
  c('511025', 'Asesoría jurídica', 'D', true),
  c('511030', 'Asesoría financiera', 'D', true),
  c('5120', 'Arrendamientos', 'D'),
  c('512010', 'Construcciones y edificaciones', 'D', true),
  c('5135', 'Servicios', 'D'),
  c('513525', 'Acueducto y alcantarillado', 'D'),
  c('513530', 'Energía eléctrica', 'D'),
  c('513535', 'Teléfono', 'D'),
  c('5160', 'Depreciaciones', 'D'),
  c('516015', 'Equipo de oficina', 'D'),
  c('516020', 'Equipo de computación y comunicación', 'D'),
  c('5195', 'Diversos', 'D'),
  c('519530', 'Útiles, papelería y fotocopias', 'D'),
  c('519595', 'Otros', 'D'),
  c('53', 'No operacionales', 'D'),
  c('5305', 'Financieros', 'D'),
  c('530505', 'Gastos bancarios', 'D'),
  c('530520', 'Intereses', 'D'),
  c('54', 'Impuesto de renta y complementarios', 'D'),
  c('5405', 'Impuesto de renta y complementarios', 'D'),
  c('540505', 'Impuesto de renta y complementarios', 'D'),

  c('6', 'COSTOS DE VENTAS', 'D'),
  c('61', 'Costo de ventas y de prestación de servicios', 'D'),
  c('6135', 'Comercio al por mayor y al por menor', 'D'),
  c('613595', 'Venta de otros productos', 'D'),
];

/** Una cuenta de la plantilla acepta movimiento si no tiene subcuentas. */
export function aceptaMovimientoEnPlantilla(codigo: string, plan: readonly CuentaPlantilla[] = PUC_SEMILLA): boolean {
  return !plan.some((x) => x.codigo !== codigo && x.codigo.startsWith(codigo) && codigoPadre(x.codigo) === codigo);
}

/** Cuentas por defecto que usa el motor en los asientos automáticos (configurables por empresa). */
export const CUENTAS_POR_DEFECTO = {
  caja: '110505',
  bancos: '111005',
  clientes: '130505',
  proveedores: '220505',
  inventario: '143505',
  ingresoVentas: '413595',
  costoVentas: '613595',
  devolucionesVentas: '417505',
  gastoCompras: '519595',
  ivaGenerado: '240805',
  ivaDescontable: '240810',
  otrosImpuestosPorPagar: '249505',
  anticiposProveedores: '133005',
  anticiposClientes: '280505',
  retefuenteAFavor: '135515',
  reteivaAFavor: '135517',
  reteicaAFavor: '135518',
  retefuentePorPagarCompras: '236540',
  retefuentePorPagarServicios: '236525',
  retefuentePorPagarHonorarios: '236515',
  reteivaPorPagar: '236701',
  reteicaPorPagar: '236801',
  utilidadEjercicio: '360505',
  perdidaEjercicio: '361005',
} as const;

export type RolCuenta = keyof typeof CUENTAS_POR_DEFECTO;
