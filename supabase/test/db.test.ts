import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

const U = {
  ana: '00000000-0000-4000-8000-00000000000a',     // propietaria de la firma 1
  beto: '00000000-0000-4000-8000-00000000000b',    // propietario de la firma 2
  carla: '00000000-0000-4000-8000-00000000000c',   // auxiliar contable en la empresa 1
  diego: '00000000-0000-4000-8000-00000000000d',   // gerente (solo lectura) en la empresa 1
};
const F1 = '10000000-0000-4000-8000-000000000001';
const F2 = '10000000-0000-4000-8000-000000000002';
const E1 = '20000000-0000-4000-8000-000000000001';
const E2 = '20000000-0000-4000-8000-000000000002';
const T1 = '30000000-0000-4000-8000-000000000001';

let db: PGlite;

/** Ejecuta como un usuario autenticado (rol authenticated + JWT sub), igual que PostgREST en Supabase. */
async function como<T = Record<string, unknown>>(usuario: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${usuario}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const lineas = (...ls: [string, string, string, string?][]) =>
  ls.map(([cuenta, debito, credito, tercero]) => ({ cuenta, debito, credito, tercero_id: tercero ?? null }));

let claveN = 0;
function comprobante(empresa: string, fecha: string, ls: ReturnType<typeof lineas>, extra: Record<string, unknown> = {}) {
  return { empresa_id: empresa, tipo: 'CG', fecha, concepto: 'Prueba', clave_idempotencia: `k${++claveN}`, lineas: ls, ...extra };
}

async function registrar(usuario: string, p: object) {
  const [r] = await como<{ r: { id: string; estado: string; numero: string | null; motivo: string | null; repetido: boolean } }>(
    usuario, 'select public.registrar_comprobante($1::jsonb) as r', [JSON.stringify(p)]);
  return r!.r;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(leer('./auth-stub.sql'));
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  // Privilegios por defecto que Supabase otorga al rol authenticated (RLS decide qué filas ve).
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert, update on public.firmas, public.usuarios, public.membresias, public.empresas, public.empresa_permisos,
      public.sucursales, public.centros_costo, public.dispositivos, public.cuentas, public.terceros,
      public.tipos_comprobante, public.impuestos, public.documentos_electronicos to authenticated;
  `);
  // Datos semilla (como administrador).
  await db.exec(`
    insert into auth.users (id) values ('${U.ana}'), ('${U.beto}'), ('${U.carla}'), ('${U.diego}');
    insert into public.usuarios (id, nombre, correo) values
      ('${U.ana}', 'Ana', 'ana@x.co'), ('${U.beto}', 'Beto', 'beto@x.co'), ('${U.carla}', 'Carla', 'carla@x.co'), ('${U.diego}', 'Diego', 'diego@x.co');
    insert into public.firmas (id, nombre) values ('${F1}', 'Firma Ana'), ('${F2}', 'Firma Beto');
    insert into public.membresias values ('${F1}', '${U.ana}', 'propietario'), ('${F2}', '${U.beto}', 'propietario'),
      ('${F1}', '${U.carla}', 'miembro'), ('${F1}', '${U.diego}', 'miembro');
    insert into public.empresas (id, firma_id, nit, dv, razon_social) values
      ('${E1}', '${F1}', '900123456', 8, 'Comercializadora Andina SAS'), ('${E2}', '${F2}', '901223556', 9, 'Suministros del Norte SAS');
    insert into public.empresa_permisos values ('${E1}', '${U.carla}', 'AuxContable'), ('${E1}', '${U.diego}', 'Gerente');
    insert into public.cuentas (empresa_id, codigo, nombre, naturaleza, nivel, acepta_movimiento, exige_tercero)
    select e, c.codigo, c.nombre, c.nat, c.nivel, c.mov, c.ter
      from (values ('${E1}'::uuid), ('${E2}'::uuid)) as es(e),
           (values ('1105', 'Caja', 'D', 3, false, false), ('111005', 'Bancos nacionales', 'D', 4, true, false),
                   ('130505', 'Clientes', 'D', 4, true, true), ('310505', 'Capital', 'C', 4, true, false),
                   ('413595', 'Ventas', 'C', 4, true, false), ('519595', 'Otros gastos', 'D', 4, true, false))
           as c(codigo, nombre, nat, nivel, mov, ter);
    insert into public.tipos_comprobante values ('${E1}', 'CG', 'Comprobante general', 'CG'), ('${E2}', 'CG', 'Comprobante general', 'CG');
    insert into public.terceros (id, empresa_id, tipo_doc, numero, nombre, tipos) values ('${T1}', '${E1}', '31', '830945221', 'El Roble SAS', '{cliente}'),
      (gen_random_uuid(), '${E2}', '13', '52330114', 'Jorge Cárdenas', '{empleado}');
  `);
});

describe('registro y contabilización (reglas 1–5)', () => {
  it('contabiliza y asigna consecutivos sin huecos', async () => {
    const a = await registrar(U.ana, comprobante(E1, '2026-09-01', lineas(['111005', '50000000', '0'], ['310505', '0', '50000000'])));
    const b = await registrar(U.ana, comprobante(E1, '2026-09-02', lineas(['130505', '119000', '0', T1], ['413595', '0', '119000'])));
    expect(a).toMatchObject({ estado: 'contabilizado', numero: 'CG-000001', repetido: false });
    expect(b).toMatchObject({ estado: 'contabilizado', numero: 'CG-000002' });
  });

  it('es idempotente: un reenvío no duplica ni consume consecutivo', async () => {
    const p = comprobante(E1, '2026-09-03', lineas(['519595', '1000', '0'], ['111005', '0', '1000']));
    const primero = await registrar(U.ana, p);
    const reenvio = await registrar(U.ana, p);
    expect(reenvio).toMatchObject({ id: primero.id, numero: primero.numero, repetido: true });
    const [{ n }] = await como<{ n: number }>(U.ana, `select count(*)::int as n from public.comprobantes where clave_idempotencia = $1`, [p.clave_idempotencia]) as [{ n: number }];
    expect(n).toBe(1);
  });

  it('rechaza descuadres, cuentas de mayor y falta de tercero, sin consumir el consecutivo', async () => {
    const d = await registrar(U.ana, comprobante(E1, '2026-09-04', lineas(['111005', '100', '0'], ['310505', '0', '99'])));
    expect(d).toMatchObject({ estado: 'rechazado' });
    expect(d.motivo).toMatch(/DESCUADRADO/);
    const m = await registrar(U.ana, comprobante(E1, '2026-09-04', lineas(['1105', '100', '0'], ['310505', '0', '100'])));
    expect(m.motivo).toMatch(/1105 \(no es auxiliar\)/);
    const t = await registrar(U.ana, comprobante(E1, '2026-09-04', lineas(['130505', '100', '0'], ['413595', '0', '100'])));
    expect(t.motivo).toMatch(/130505 \(exige tercero\)/);
    const neg = await registrar(U.ana, comprobante(E1, '2026-09-04', lineas(['111005', '100', '100'], ['310505', '0', '0'])));
    expect(neg.estado).toBe('rechazado');
    const ok = await registrar(U.ana, comprobante(E1, '2026-09-05', lineas(['111005', '5', '0'], ['310505', '0', '5'])));
    expect(ok.numero).toBe('CG-000004'); // 1, 2, 3 (idempotencia) y este: sin huecos
  });

  it('regla 4: no contabiliza en períodos cerrados; reabrir exige permiso', async () => {
    await como(U.ana, `select public.cambiar_estado_periodo($1, 2026, 8, 'cerrado')`, [E1]);
    const r = await registrar(U.ana, comprobante(E1, '2026-08-31', lineas(['111005', '5', '0'], ['310505', '0', '5'])));
    expect(r.motivo).toMatch(/PERIODO_CERRADO/);
    await expect(como(U.carla, `select public.cambiar_estado_periodo($1, 2026, 8, 'abierto')`, [E1])).rejects.toThrow(/SIN_PERMISO/);
  });

  it('el auxiliar contable deja borradores; el contador los aprueba', async () => {
    const r = await registrar(U.carla, comprobante(E1, '2026-09-06', lineas(['519595', '7000', '0'], ['111005', '0', '7000'])));
    expect(r).toMatchObject({ estado: 'borrador', numero: null });
    await expect(como(U.carla, 'select public.aprobar_comprobante($1)', [r.id])).rejects.toThrow(/SIN_PERMISO/);
    const [a] = await como<{ n: string }>(U.ana, 'select public.aprobar_comprobante($1) as n', [r.id]);
    expect(a!.n).toBe('CG-000005');
  });

  it('el gerente (solo lectura) no puede registrar', async () => {
    await expect(registrar(U.diego, comprobante(E1, '2026-09-06', lineas(['111005', '1', '0'], ['310505', '0', '1'])))).rejects.toThrow(/SIN_PERMISO/);
  });
});

describe('inmutabilidad (regla 6) y auditoría', () => {
  it('nadie puede editar ni borrar un comprobante contabilizado, ni siquiera el administrador de la base', async () => {
    const r = await registrar(U.ana, comprobante(E1, '2026-09-07', lineas(['111005', '10', '0'], ['310505', '0', '10'])));
    await expect(db.query(`update public.comprobantes set concepto = 'cambiado' where id = $1`, [r.id])).rejects.toThrow(/INMUTABLE/);
    await expect(db.query(`delete from public.comprobantes where id = $1`, [r.id])).rejects.toThrow(/INMUTABLE/);
    await expect(db.query(`update public.lineas set debito = 20 where comprobante_id = $1 and debito > 0`, [r.id])).rejects.toThrow(/INMUTABLE/);
    await expect(db.query(`insert into public.lineas (comprobante_id, empresa_id, orden, cuenta, debito) values ($1, $2, 9, '111005', 1)`, [r.id, E1])).rejects.toThrow(/INMUTABLE/);
  });

  it('los usuarios no pueden escribir directo en comprobantes (solo por las funciones)', async () => {
    await expect(como(U.ana, `insert into public.comprobantes (empresa_id, tipo, fecha, concepto) values ($1, 'CG', '2026-09-01', 'x')`, [E1]))
      .rejects.toThrow(/permission denied/);
  });

  it('anula con reverso: el original queda anulado y el saldo neto en cero', async () => {
    const r = await registrar(U.ana, comprobante(E1, '2026-09-08', lineas(['519595', '250000', '0'], ['111005', '0', '250000'])));
    await expect(como(U.ana, `select public.anular_comprobante($1, ' ')`, [r.id])).rejects.toThrow(/FALTA_MOTIVO/);
    const [a] = await como<{ r: { numero: string } }>(U.ana, `select public.anular_comprobante($1, 'Registrado dos veces') as r`, [r.id]);
    expect(a!.r.numero).toMatch(/^CG-\d{6}$/);
    const [o] = await como<{ estado: string; motivo_anulacion: string }>(U.ana, 'select estado, motivo_anulacion from public.comprobantes where id = $1', [r.id]);
    expect(o).toEqual({ estado: 'anulado', motivo_anulacion: 'Registrado dos veces' });
    const [s] = await como<{ saldo: string }>(U.ana, `
      select sum(l.debito - l.credito)::text as saldo from public.lineas l join public.comprobantes c on c.id = l.comprobante_id
       where l.cuenta = '519595' and (c.id = $1 or c.reversa_de = $1)`, [r.id]);
    expect(Number(s!.saldo)).toBe(0);
    await expect(como(U.ana, `select public.anular_comprobante($1, 'otra vez')`, [r.id])).rejects.toThrow(/ESTADO_INVALIDO/);
  });

  it('la auditoría solo agrega registros', async () => {
    const [{ n }] = (await db.query<{ n: number }>('select count(*)::int as n from public.auditoria')).rows as [{ n: number }];
    expect(n).toBeGreaterThan(0);
    await expect(db.query('update public.auditoria set accion = accion')).rejects.toThrow(/INMUTABLE/);
    await expect(db.query('delete from public.auditoria')).rejects.toThrow(/INMUTABLE/);
  });
});

describe('RLS: el usuario A nunca ve la empresa B', () => {
  it('cada usuario ve solo sus empresas, comprobantes, líneas y cambios', async () => {
    await registrar(U.beto, comprobante(E2, '2026-09-01', lineas(['111005', '1', '0'], ['310505', '0', '1'])));
    for (const tabla of ['empresas', 'comprobantes', 'lineas', 'cuentas', 'terceros', 'cambios', 'consecutivos']) {
      const col = tabla === 'empresas' ? 'id' : 'empresa_id';
      const deBeto = await como<{ e: string }>(U.beto, `select distinct ${col}::text as e from public.${tabla}`);
      expect(deBeto.map((x) => x.e), `beto en ${tabla}`).not.toContain(E1);
      const deAna = await como<{ e: string }>(U.ana, `select distinct ${col}::text as e from public.${tabla}`);
      expect(deAna.map((x) => x.e), `ana en ${tabla}`).not.toContain(E2);
      expect(deAna.map((x) => x.e), `ana sí ve lo suyo en ${tabla}`).toContain(E1);
      expect(deBeto.map((x) => x.e), `beto sí ve lo suyo en ${tabla}`).toContain(E2);
    }
  });
  it('no se puede registrar en una empresa ajena', async () => {
    await expect(registrar(U.beto, comprobante(E1, '2026-09-01', lineas(['111005', '1', '0'], ['310505', '0', '1'])))).rejects.toThrow(/SIN_PERMISO/);
  });
  it('la auditoría no la ve un auxiliar sin permiso de auditoría', async () => {
    expect(await como(U.carla, 'select * from public.auditoria')).toEqual([]);
    expect((await como(U.diego, 'select * from public.auditoria')).length).toBeGreaterThan(0); // gerente: auditoría READ
  });
  it('sin sesión no se ve nada', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role authenticated;`);
    try {
      expect((await db.query('select * from public.comprobantes')).rows).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });
});

describe('sincronización incremental (sección 9.3)', () => {
  it('la secuencia de cambios crece y permite pedir solo lo nuevo', async () => {
    const antes = await como<{ seq: number }>(U.ana, `select max(seq)::int as seq from public.cambios where empresa_id = $1`, [E1]);
    const ultima = antes[0]!.seq;
    const r = await registrar(U.ana, comprobante(E1, '2026-09-09', lineas(['111005', '3', '0'], ['310505', '0', '3'])));
    const nuevos = await como<{ tabla: string; registro_id: string; operacion: string }>(U.ana,
      `select tabla, registro_id, operacion from public.cambios where empresa_id = $1 and seq > $2 order by seq`, [E1, ultima]);
    expect(nuevos.map((c) => c.registro_id)).toContain(r.id);
    expect(nuevos.every((c) => c.tabla === 'comprobantes')).toBe(true);
  });
});
