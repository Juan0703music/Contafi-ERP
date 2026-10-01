import { leerTarifaUsuario, leerMontoUsuario, type Centavos } from '@contafi/shared';
import { kardex, type EstadoInventario, type MovimientoKardex } from '@contafi/motor';
import { productoSync, type ProductoSync } from '@contafi/sync';
import { s, type BaseLocal } from './base.ts';
import { ErrorLocal, comprobantesParaReportes } from './contabilidad.ts';

/** Producto o servicio de la empresa (sección 11.1: inventario básico). */
export interface ProductoLocal {
  id: string;
  codigo: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  unidad: string;
  cuentaInventario: string;
  iva: { tipo: 'gravado' | 'exento' | 'excluido'; tarifa?: bigint };
  precioVenta: Centavos | null;
  activo: boolean;
  pendiente: boolean;
  erroresSync: string | null;
}

export interface DatosProducto {
  codigo: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  unidad: string;
  cuentaInventario?: string;
  /** "19", "5", "exento", "excluido" */
  iva: string;
  precioVenta?: string;
}

function aProductoSync(id: string, d: DatosProducto): ProductoSync {
  const gravado = d.iva !== 'exento' && d.iva !== 'excluido';
  const tarifa = gravado ? leerTarifaUsuario(d.iva) : null;
  if (gravado && tarifa === null) throw new ErrorLocal('DATOS_INVALIDOS', `Tarifa de IVA inválida: "${d.iva}".`);
  const precio = d.precioVenta?.trim() ? leerMontoUsuario(d.precioVenta) : null;
  if (d.precioVenta?.trim() && (precio === null || precio < 0n)) throw new ErrorLocal('DATOS_INVALIDOS', 'Precio de venta inválido.');
  const r = productoSync.safeParse({
    id, codigo: d.codigo, nombre: d.nombre, tipo: d.tipo, unidad: d.unidad || 'UND', cuenta_inventario: d.cuentaInventario || '143505',
    iva_tipo: gravado ? 'gravado' : d.iva, iva_tarifa_ppm: tarifa === null ? null : Number(tarifa),
    precio_venta: precio === null ? null : `${precio / 100n}.${String(precio % 100n).padStart(2, '0')}`, activo: true,
  });
  if (!r.success) throw new ErrorLocal('DATOS_INVALIDOS', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

function sentenciasProducto(empresa: string, p: ProductoSync, crear: boolean, precio: Centavos | null) {
  const valores = [p.codigo, p.nombre, p.tipo, p.unidad, p.cuenta_inventario, p.iva_tipo, p.iva_tarifa_ppm ?? null, precio, p.activo] as const;
  return [
    crear
      ? s(`insert into productos (id, empresa_id, codigo, nombre, tipo, unidad, cuenta_inventario, iva_tipo, iva_tarifa_ppm, precio_venta, activo)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.id, empresa, ...valores)
      : s(`update productos set codigo = ?, nombre = ?, tipo = ?, unidad = ?, cuenta_inventario = ?, iva_tipo = ?, iva_tarifa_ppm = ?,
             precio_venta = ?, activo = ?, errores_sync = null where id = ?`, ...valores, p.id),
    s(`insert into cola_salida (empresa_id, tipo, registro_id, creado_en) values (?, 'producto', ?, ?)
       on conflict (empresa_id, tipo, registro_id) do nothing`, empresa, p.id, new Date().toISOString()),
  ];
}

/** Crea un producto (funciona sin conexión). */
export async function crearProducto(base: BaseLocal, empresa: string, d: DatosProducto): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const p = aProductoSync(id, d);
  const [dup] = await base.consultar<{ nombre: string }>('select nombre from productos where empresa_id = ? and codigo = ?', [empresa, p.codigo]);
  if (dup) throw new ErrorLocal('PRODUCTO_DUPLICADO', `Ya existe un producto con el código ${p.codigo}: ${dup.nombre}.`);
  await base.lote(sentenciasProducto(empresa, p, true, d.precioVenta?.trim() ? leerMontoUsuario(d.precioVenta) : null));
  return id;
}

export async function editarProducto(base: BaseLocal, empresa: string, id: string, d: DatosProducto): Promise<void> {
  const p = aProductoSync(id, d);
  await base.lote(sentenciasProducto(empresa, p, false, d.precioVenta?.trim() ? leerMontoUsuario(d.precioVenta) : null));
}

export async function productosLocales(base: BaseLocal, empresa: string): Promise<ProductoLocal[]> {
  const filas = await base.consultar<Record<string, string | number | null>>(
    `select p.*, cast(p.precio_venta as text) as precio, exists (select 1 from cola_salida c where c.tipo = 'producto' and c.registro_id = p.id) as pendiente
       from productos p where p.empresa_id = ? order by p.nombre`, [empresa]);
  return filas.map((f) => ({
    id: String(f['id']), codigo: String(f['codigo']), nombre: String(f['nombre']), tipo: f['tipo'] as 'producto' | 'servicio',
    unidad: String(f['unidad']), cuentaInventario: String(f['cuenta_inventario']),
    iva: f['iva_tipo'] === 'gravado' ? { tipo: 'gravado', tarifa: BigInt(f['iva_tarifa_ppm'] ?? 0) } : { tipo: f['iva_tipo'] as 'exento' | 'excluido' },
    precioVenta: f['precio'] == null ? null : BigInt(String(f['precio'])), activo: !!f['activo'],
    pendiente: !!f['pendiente'], erroresSync: (f['errores_sync'] as string | null) ?? null,
  }));
}

/** Kárdex de un producto, calculado desde los comprobantes (incluye lo pendiente de sincronizar). */
export async function kardexLocal(base: BaseLocal, empresa: string, productoId: string): Promise<{ movimientos: MovimientoKardex[]; estado: EstadoInventario }> {
  return kardex(await comprobantesParaReportes(base, empresa, { incluirPendientes: true }), productoId);
}

export interface Existencia {
  producto: ProductoLocal;
  cantidad: bigint;
  valor: Centavos;
  costoPromedio: Centavos;
}

export async function existencias(base: BaseLocal, empresa: string): Promise<Existencia[]> {
  const [productos, cs] = await Promise.all([productosLocales(base, empresa), comprobantesParaReportes(base, empresa, { incluirPendientes: true })]);
  return productos.filter((p) => p.tipo === 'producto').map((p) => {
    const { estado } = kardex(cs, p.id);
    return { producto: p, cantidad: estado.cantidad, valor: estado.valor, costoPromedio: estado.costoUnitario };
  });
}
