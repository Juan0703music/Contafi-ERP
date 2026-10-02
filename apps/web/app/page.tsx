import Link from 'next/link';

const VENTAJAS = [
  { titulo: 'Todas tus empresas, una sola vista', texto: 'Pendientes, alertas, meses sin cerrar y vencimientos de cada empresa en el panel del contador.' },
  { titulo: 'Funciona sin internet', texto: 'Registra en el PC aunque se vaya la conexión; al volver, todo se sincroniza solo y recibe su número oficial, sin duplicados.' },
  { titulo: 'Facturas de la DIAN en segundos', texto: 'Carga los XML o ZIP: reconoce el proveedor, el IVA y los totales, propone el asiento y aprende la cuenta de cada proveedor.' },
  { titulo: 'Jarvis, tu asesor con IA local', texto: 'Pregúntale por escrito o con la voz: «¿cuánto nos deben los clientes?». Las cifras salen de los libros y nada sale de tu PC.' },
  { titulo: 'Impuestos sin tarifas quemadas', texto: 'UVT, retenciones y calendario tributario configurables cada año, compartidos por toda la firma.' },
  { titulo: 'Seguro por diseño', texto: 'Base local cifrada, verificación en dos pasos para administradores y permisos por empresa y por rol.' },
];

export default function Inicio() {
  return (
    <main>
      <section className="heroe">
        <div className="contenedor">
          <p className="etiqueta">Contabilidad multi-empresa para contadores en Colombia</p>
          <h1>Todas tus empresas, aunque se vaya el internet.</h1>
          <p className="entrada">Contafi lleva la contabilidad de tus clientes en tu PC y en la nube a la vez: rápido, sin conexión cuando haga falta y con un asesor de IA que no manda tus datos a nadie.</p>
          <div className="acciones">
            <Link href="/precios" className="boton primario">Ver planes · 30 días gratis</Link>
            <Link href="/descargar" className="boton">Descargar para Windows</Link>
          </div>
        </div>
      </section>
      <section className="contenedor rejilla">
        {VENTAJAS.map((v) => (
          <article key={v.titulo} className="tarjeta"><h2>{v.titulo}</h2><p>{v.texto}</p></article>
        ))}
      </section>
      <section className="contenedor franja">
        <div>
          <h2>¿Vienes de otro programa?</h2>
          <p>Trae el plan de cuentas, los terceros y los saldos desde Excel, y compara el balance de Contafi con el de tu software anterior hasta llegar a cero diferencias.</p>
        </div>
        <Link href="/ayuda/migrar" className="boton">Cómo migrar</Link>
      </section>
    </main>
  );
}
