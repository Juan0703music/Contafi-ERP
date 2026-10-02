/**
 * Base de conocimiento (Fase 7): guías cortas de las tareas principales. Los nombres de pantallas y botones
 * son los de la app; si cambian allá, se actualizan aquí.
 */
export interface Articulo {
  slug: string;
  titulo: string;
  resumen: string;
  categoria: 'Primeros pasos' | 'Contabilidad' | 'Impuestos' | 'Equipo y datos' | 'Jarvis';
  secciones: { titulo: string; pasos: string[] }[];
}

export const ARTICULOS: Articulo[] = [
  {
    slug: 'empezar',
    titulo: 'Crear tu cuenta, tu firma y tu primera empresa',
    resumen: 'De la instalación a la primera empresa con su plan de cuentas, en unos minutos.',
    categoria: 'Primeros pasos',
    secciones: [
      { titulo: 'Crear la cuenta', pasos: [
        'Abre Contafi y elige «Crear una cuenta». Escribe tu nombre, tu correo y una contraseña de al menos 10 caracteres.',
        'Confirma el correo desde el mensaje que te llega y vuelve a ingresar.',
      ] },
      { titulo: 'Crear la firma y la primera empresa', pasos: [
        'En la bienvenida, escribe el nombre de tu firma (o tu nombre, si trabajas solo) y elige «Crear mi firma».',
        'Activa la verificación en dos pasos: escanea el código QR con Google Authenticator, Microsoft Authenticator o similar y escribe el código de 6 dígitos. Es obligatoria para administrar una firma.',
        'Registra la primera empresa: NIT (el dígito de verificación se calcula solo), razón social y grupo NIIF. Se crea con el PUC completo de clases y grupos y los tipos de comprobante.',
      ] },
      { titulo: '¿Te invitaron?', pasos: [
        'Abre el enlace del correo de invitación y copia el código.',
        'Ingresa a Contafi con el mismo correo de la invitación y, en la bienvenida, pega el código en «Unirme a la firma».',
      ] },
    ],
  },
  {
    slug: 'instalar-windows',
    titulo: 'Instalar Contafi en Windows',
    resumen: 'Requisitos, instalación y qué hacer si Windows muestra una advertencia.',
    categoria: 'Primeros pasos',
    secciones: [
      { titulo: 'Requisitos', pasos: [
        'Windows 10 o 11 de 64 bits.',
        '4 GB de RAM para trabajar; 8 GB o más para usar a Jarvis con IA local (con menos, Jarvis responde con su asistente por reglas).',
        'Unos 300 MB libres para el programa y los datos; la IA local ocupa 2,5 GB adicionales si la descargas.',
      ] },
      { titulo: 'Instalación', pasos: [
        'Descarga el instalador desde la página Descargar y ábrelo.',
        'Si Windows muestra «Windows protegió su PC» (SmartScreen), elige «Más información» y luego «Ejecutar de todas formas». Aparece mientras el instalador gana reputación o hasta que tenga firma de código.',
        'Al terminar, abre Contafi desde el menú Inicio.',
      ] },
      { titulo: 'Tus datos en el PC', pasos: [
        'La base de datos del equipo está cifrada; la llave queda protegida por Windows en tu usuario.',
        'Contafi hace un respaldo diario automático (guarda los últimos 7) y, si la base se daña, la restaura sola y vuelve a sincronizar con la nube.',
      ] },
    ],
  },
  {
    slug: 'migrar',
    titulo: 'Migrar desde tu software anterior',
    resumen: 'Plan de cuentas, terceros y saldos iniciales desde Excel (CSV), con plantillas.',
    categoria: 'Primeros pasos',
    secciones: [
      { titulo: 'Plan de cuentas', pasos: [
        'En tu software anterior exporta el plan de cuentas a Excel y guárdalo como CSV (código y nombre; una tercera columna «sí» si la cuenta exige tercero).',
        'En Contafi: Plan de cuentas → Importar CSV. Se crean solo las cuentas que faltan, de padre a hijo; las que ya existen no se tocan.',
      ] },
      { titulo: 'Terceros', pasos: [
        'Terceros → Importar CSV → Descargar plantilla. Llena tipo de documento, número, nombre, tipos (cliente, proveedor…), correo, municipio, dirección y responsabilidades fiscales.',
        'Al cargarlo verás los errores por fila antes de importar. El DV de los NIT se calcula solo.',
      ] },
      { titulo: 'Saldos iniciales', pasos: [
        'Saldos iniciales → Descargar plantilla: una fila por cuenta auxiliar (y por tercero cuando la cuenta lo exige).',
        'Si un tercero no existe, escribe su nombre en la columna nombre_tercero (y el tipo de documento si no es NIT): se crea al guardar.',
        'Carga el archivo, revisa que diga «Balanceado» y elige «Crear comprobante de saldos iniciales».',
      ] },
      { titulo: 'Doble corrida', pasos: [
        'Durante el primer mes lleva la empresa en ambos programas. Al cierre, saca el balance de prueba del software anterior a la misma fecha, guárdalo como CSV y cárgalo en Reportes → Doble corrida.',
        'La meta es «Cero diferencias». Si hay diferencias, la tabla muestra cada cuenta con el saldo de cada programa.',
      ] },
    ],
  },
  {
    slug: 'importar-dian',
    titulo: 'Importar facturas electrónicas de la DIAN',
    resumen: 'Carga XML o ZIP, revisa la propuesta y contabiliza en lote. Contafi aprende la cuenta de cada proveedor.',
    categoria: 'Contabilidad',
    secciones: [
      { titulo: 'Importar', pasos: [
        'Importar DIAN → arrastra los XML o los ZIP del correo (varios a la vez).',
        'Contafi reconoce el proveedor (lo crea si no existe), el IVA por tarifa, los totales y propone el asiento. Los duplicados (mismo CUFE) se marcan y no se importan dos veces, ni siquiera desde otro PC.',
        'Cambia la cuenta o las retenciones si hace falta y contabiliza.',
      ] },
      { titulo: 'Reglas por proveedor', pasos: [
        'Cuando eliges otra cuenta o cambias las retenciones de un proveedor, Contafi lo aprende y lo propone la próxima vez.',
        'Lo aprendido se comparte con los demás PC de la empresa al sincronizar.',
      ] },
    ],
  },
  {
    slug: 'ventas-compras',
    titulo: 'Ventas, compras, recaudos y pagos',
    resumen: 'Facturas con IVA por tarifa y retenciones, cartera por edades y abonos parciales.',
    categoria: 'Contabilidad',
    secciones: [
      { titulo: 'Facturas', pasos: [
        'Ventas y compras → Factura de venta (o de compra). Elige el tercero, agrega los ítems con su IVA (19 %, 5 %, exento o excluido) y las retenciones que apliquen.',
        'Si el ítem es un producto del inventario, la salida y el costo de ventas se registran solos, con el costo promedio del kárdex.',
      ] },
      { titulo: 'Recaudos y pagos', pasos: [
        'Registra el recaudo de un cliente o el pago a un proveedor; puede ser parcial. La cartera por edades se actualiza de inmediato.',
      ] },
    ],
  },
  {
    slug: 'conciliacion',
    titulo: 'Conciliación bancaria',
    resumen: 'Carga el extracto del banco en CSV y concilia automática o manualmente.',
    categoria: 'Contabilidad',
    secciones: [
      { titulo: 'Pasos', pasos: [
        'Conciliación bancaria → elige la cuenta del banco y carga el extracto (CSV del banco: valor con signo o columnas de débito y crédito).',
        'Contafi empareja automáticamente los movimientos por valor y fecha cercana; puedes emparejar o separar a mano.',
        'Los cargos del extracto que no están en los libros (comisiones, 4×1000) se pueden registrar desde la misma pantalla.',
      ] },
    ],
  },
  {
    slug: 'cierres',
    titulo: 'Cierre mensual y cierre anual',
    resumen: 'Cerrar meses para que nadie los modifique y generar el comprobante de cierre del año.',
    categoria: 'Contabilidad',
    secciones: [
      { titulo: 'Cierre mensual', pasos: [
        'Períodos y cierres → cierra el mes. Un mes cerrado no recibe comprobantes nuevos, en ningún PC. Cerrar o reabrir requiere conexión y permiso de cierres.',
      ] },
      { titulo: 'Cierre anual', pasos: [
        'Sincroniza antes: el cierre se genera con lo oficial. Contafi lleva la utilidad o pérdida a la cuenta 3605/3610 y deja en cero las cuentas de resultado (clases 4 a 7).',
      ] },
    ],
  },
  {
    slug: 'impuestos',
    titulo: 'UVT, retenciones y calendario tributario',
    resumen: 'Contafi no trae tarifas escritas: se configuran con la norma vigente y se comparten con toda la firma.',
    categoria: 'Impuestos',
    secciones: [
      { titulo: 'UVT y retenciones', pasos: [
        'Impuestos y retenciones → escribe la UVT del año según la resolución de la DIAN. Se guarda para toda la firma.',
        'Crea los conceptos de retención (retefuente, reteIVA, reteICA) con su tarifa, base mínima en UVT y cuenta. Se usan al facturar y al importar de la DIAN.',
      ] },
      { titulo: 'Calendario tributario', pasos: [
        'Descarga la plantilla del calendario, copia las fechas del decreto del año (obligación, período, último dígito del NIT y fecha) y cárgala.',
        'Marca las obligaciones de cada empresa. El Panel, Mis empresas y Jarvis te avisan lo que vence en los próximos días.',
      ] },
      { titulo: 'Auxiliar de impuestos', pasos: [
        'Libros → Impuestos: IVA generado y descontable, saldo a pagar y las retenciones con su base, por cuenta y por tercero (para los certificados).',
      ] },
    ],
  },
  {
    slug: 'sin-conexion',
    titulo: 'Trabajar sin internet y sincronizar',
    resumen: 'Todo funciona sin conexión; al volver el internet se envía solo y recibe su número oficial.',
    categoria: 'Equipo y datos',
    secciones: [
      { titulo: 'Cómo funciona', pasos: [
        'Lo que registras se guarda en el PC al instante con un número provisional (por ejemplo CG-LOCAL-1A2B).',
        'Con internet, Contafi sincroniza sola al abrir, cada minuto y al guardar: los comprobantes reciben su número oficial sin huecos y lo de los otros PC llega a este.',
        'Si el servidor rechaza algo (por ejemplo, un mes cerrado), aparece en Sincronización con el motivo.',
      ] },
      { titulo: 'Si algo no sincroniza', pasos: [
        'Sincronización → Diagnóstico para soporte → Copiar diagnóstico, y envíalo a soporte. No incluye montos ni nombres.',
      ] },
    ],
  },
  {
    slug: 'jarvis',
    titulo: 'Jarvis: preguntas, alertas y voz',
    resumen: 'Pregunta en español por los datos de la empresa; las cifras salen del motor contable.',
    categoria: 'Jarvis',
    secciones: [
      { titulo: 'Preguntar', pasos: [
        'Escribe o di tu pregunta: «¿cuánta plata tenemos en bancos?», «¿qué clientes deben más de 90 días?», «¿qué vence esta semana?».',
        'Toda cifra viene de los libros; si el modelo escribiera una cifra que no salió de los datos, se marca «Cifra no verificada».',
      ] },
      { titulo: 'Voz', pasos: [
        'En el panel Voz descarga el reconocimiento de voz y elige la voz de Jarvis (Claude, Ald o Daniela) con «Escuchar ejemplo».',
        'Toca el micrófono, haz la pregunta y una pausa. Con «Conversación manos libres», Jarvis responde en voz alta y vuelve a escucharte.',
        'Todo ocurre en el PC: el audio no se guarda ni sale del equipo.',
      ] },
    ],
  },
  {
    slug: 'equipo',
    titulo: 'Equipo de la firma y permisos',
    resumen: 'Invitar, asignar roles por empresa y quitar accesos.',
    categoria: 'Equipo y datos',
    secciones: [
      { titulo: 'Pasos', pasos: [
        'Equipo de la firma → Invitar: correo, rol en la firma (miembro o administrador) y rol en cada empresa (Contador, Auxiliar contable, Tesorero, Gerente, Auditor).',
        'La persona recibe un correo con el enlace; vence en 7 días. Las invitaciones pendientes ocupan un puesto del plan.',
        'Accesos cambia los roles; Quitar le retira el acceso a todas las empresas (lo que registró se conserva en la auditoría).',
      ] },
    ],
  },
];

export const CATEGORIAS = ['Primeros pasos', 'Contabilidad', 'Impuestos', 'Equipo y datos', 'Jarvis'] as const;
