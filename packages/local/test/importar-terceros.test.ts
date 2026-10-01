import { describe, expect, it } from 'vitest';
import { migrar, guardarEmpresas, leerTercerosCsv, importarTerceros, tercerosLocales, PLANTILLA_TERCEROS, crearTercero, editarTercero } from '../src/index.ts';
import { baseNode } from './ayudas.ts';

describe('importación masiva de terceros', () => {
  it('lee la plantilla y calcula el DV si viene vacío', () => {
    const r = leerTercerosCsv(PLANTILLA_TERCEROS);
    expect(r.errores).toEqual([]);
    expect(r.terceros).toEqual([
      expect.objectContaining({ tipo_doc: '31', numero: '830945221', dv: 8, tipos: ['cliente'], correo: 'compras@elroble.co', responsabilidades: ['O-13', 'O-23'] }),
      expect.objectContaining({ tipo_doc: '13', numero: '1032556789', dv: null, tipos: ['cliente', 'empleado'], responsabilidades: ['R-99-PN'] }),
    ]);
    expect(leerTercerosCsv('NIT;800.197.268;;DIAN;otro').terceros[0]).toMatchObject({ numero: '800197268', dv: 4 });
  });

  it('reporta errores por fila', () => {
    const csv = ['tipo;numero;dv;nombre;tipos;correo', 'RUT;1;;X;cliente', 'NIT;830945221;3;El Roble;cliente', 'CC;123456;;;cliente',
      'CC;123456;;Ana;socio', 'CC;123457;;Beto;cliente;sin-arroba', 'CC;123458;;Carla;cliente', 'CC;123458;;Carla otra vez;cliente'].join('\n');
    const r = leerTercerosCsv(csv);
    expect(r.errores).toEqual([
      'Fila 2: tipo de documento "RUT" no reconocido (use NIT, CC, CE, PASAPORTE o TI).',
      'Fila 3: el dígito de verificación del NIT 830945221 es 8, no 3.',
      'Fila 4: falta el nombre.',
      'Fila 5: tipo de tercero "socio" no válido (cliente, proveedor, empleado, otro).',
      'Fila 6: correo inválido "sin-arroba".',
      'Fila 8: el documento 123458 está repetido en el archivo.',
    ]);
    expect(r.terceros.map((t) => t.nombre)).toEqual(['Carla']);
  });

  it('crea los nuevos y omite los que ya existían; quedan en la cola para sincronizar', async () => {
    const base = baseNode();
    await migrar(base);
    await guardarEmpresas(base, [{ id: 'e1', firma_id: 'f', nit: '900123456', dv: 8, razon_social: 'Andina' }]);
    await crearTercero(base, 'e1', { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'El Roble (ya creado)' });
    const r = await importarTerceros(base, 'e1', leerTercerosCsv(PLANTILLA_TERCEROS).terceros);
    expect(r).toEqual({ creados: 1, omitidos: ['Distribuciones El Roble S.A.S. (830945221): ya existía.'] });
    expect((await tercerosLocales(base, 'e1')).every((t) => t.pendiente)).toBe(true);
  });
});

describe('límites del servidor al importar terceros', () => {
  it('rechaza por fila un nombre demasiado largo', () => {
    const r = leerTercerosCsv(`CC;123456;;${'x'.repeat(301)};cliente,cliente`);
    expect(r.terceros).toEqual([]);
    expect(r.errores[0]).toMatch(/^Fila 1: nombre /);
    expect(leerTercerosCsv('CC;123456;;Ana;cliente,cliente').terceros[0]?.tipos).toEqual(['cliente']);
    expect(leerTercerosCsv('NIT;900123456;;X;proveedor;;;;o-15 O-99').errores).toEqual([
      'Fila 1: responsabilidad fiscal "O-99" no reconocida (use O-13, O-15, O-23, O-47, R-99-PN).']);
  });
});

describe('editar terceros', () => {
  it('guarda responsabilidades y no permite tomar el documento de otro tercero', async () => {
    const base = baseNode();
    await migrar(base);
    await guardarEmpresas(base, [{ id: 'e1', firma_id: 'f', nit: '900123456', dv: 8, razon_social: 'Andina' }]);
    await crearTercero(base, 'e1', { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'El Roble' });
    const id = await crearTercero(base, 'e1', { tipo_doc: '13', numero: '1032556789', nombre: 'Laura' });
    await editarTercero(base, id, { tipo_doc: '13', numero: '1032556789', nombre: 'Laura Restrepo', responsabilidades: ['R-99-PN'], tipos: ['empleado'] });
    expect((await tercerosLocales(base, 'e1', 'Laura'))[0]).toMatchObject({ nombre: 'Laura Restrepo', responsabilidades: ['R-99-PN'], tipos: ['empleado'] });
    await expect(editarTercero(base, id, { tipo_doc: '31', numero: '830945221', dv: 8, nombre: 'Laura' })).rejects.toThrow(/otro tercero.*El Roble/);
  });
});
