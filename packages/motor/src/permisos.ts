/** Matriz de permisos portada del prototipo. En producción se aplica en el servidor (RLS); la app solo la usa para mostrar u ocultar opciones. */
export type Modulo = 'contabilidad' | 'ventas' | 'compras' | 'tesoreria' | 'inventario' | 'nomina' | 'cierres' | 'auditoria' | 'configuracion';
export type Nivel = 'NONE' | 'READ' | 'CREATE' | 'APPROVE' | 'FULL';
export type Rol = 'SuperAdmin' | 'Contador' | 'AuxContable' | 'Tesorero' | 'Gerente' | 'Auditor';

const ORDEN: Record<Nivel, number> = { NONE: 0, READ: 1, CREATE: 2, APPROVE: 3, FULL: 4 };

export const PERMISOS: Record<Rol, Record<Modulo, Nivel>> = {
  SuperAdmin: { contabilidad: 'FULL', ventas: 'FULL', compras: 'FULL', tesoreria: 'FULL', inventario: 'FULL', nomina: 'FULL', cierres: 'FULL', auditoria: 'FULL', configuracion: 'FULL' },
  Contador: { contabilidad: 'FULL', ventas: 'READ', compras: 'READ', tesoreria: 'APPROVE', inventario: 'READ', nomina: 'APPROVE', cierres: 'FULL', auditoria: 'READ', configuracion: 'READ' },
  AuxContable: { contabilidad: 'CREATE', ventas: 'CREATE', compras: 'CREATE', tesoreria: 'READ', inventario: 'CREATE', nomina: 'NONE', cierres: 'NONE', auditoria: 'NONE', configuracion: 'NONE' },
  Tesorero: { contabilidad: 'READ', ventas: 'READ', compras: 'READ', tesoreria: 'FULL', inventario: 'READ', nomina: 'READ', cierres: 'NONE', auditoria: 'NONE', configuracion: 'NONE' },
  Gerente: { contabilidad: 'READ', ventas: 'READ', compras: 'READ', tesoreria: 'READ', inventario: 'READ', nomina: 'READ', cierres: 'NONE', auditoria: 'READ', configuracion: 'NONE' },
  Auditor: { contabilidad: 'READ', ventas: 'READ', compras: 'READ', tesoreria: 'READ', inventario: 'READ', nomina: 'READ', cierres: 'NONE', auditoria: 'FULL', configuracion: 'NONE' },
};

export function puede(rol: Rol, modulo: Modulo, minimo: Nivel): boolean {
  return ORDEN[PERMISOS[rol][modulo]] >= ORDEN[minimo];
}
