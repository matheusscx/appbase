import { repartirResultado } from './resultado-sii';
import type { EstadoEnvioSii } from './sii-boleta.cliente';

// Folios no consecutivos, y una 39 y una 41 con el mismo folio (2053): se reparte por
// (tipo, folio), no solo por folio.
const B2041 = { documentoId: 'doc-2041', tipo: 39, folio: 2041 };
const B2053 = { documentoId: 'doc-2053', tipo: 39, folio: 2053 };
const B2077 = { documentoId: 'doc-2077', tipo: 39, folio: 2077 };
const B2090 = { documentoId: 'doc-2090', tipo: 39, folio: 2090 };
const B2053_41 = { documentoId: 'doc-2053-41', tipo: 41, folio: 2053 };
const CUATRO = [B2041, B2053, B2077, B2090];

const error = (codigo: number, descripcion: string) => ({
  seccion: 'Encabezado',
  linea: 14,
  nivel: 1,
  codigo,
  descripcion,
  detalle: `detalle ${codigo.toString()}`,
});

describe('repartirResultado', () => {
  describe('EPR y RPR: cada boleta según detalle_rep_rech', () => {
    it('EPR sin detalle: todas aceptadas, y el envío es final', () => {
      const r = repartirResultado({ estado: 'EPR' }, CUATRO);
      expect(r.final).toBe(true);
      expect(r.cambios).toEqual(
        CUATRO.map((b) => ({
          documentoId: b.documentoId,
          estado: 'aceptado',
          detalleSii: null,
        })),
      );
    });

    it('un sobre mixto: una rechazada con dos errores, una con reparos y dos aceptadas', () => {
      const rechazada = {
        tipo: 39,
        folio: 2053,
        estado: 'RCH',
        descripcion: 'Boleta rechazada',
        error: [error(301, 'Monto no cuadra'), error(305, 'RUT inválido')],
      };
      const reparo = {
        tipo: 39,
        folio: 2077,
        estado: 'RPR',
        descripcion: 'Boleta con reparos',
        error: [error(120, 'Giro largo')],
      };
      const r = repartirResultado(
        { estado: 'EPR', detalle_rep_rech: [rechazada, reparo] },
        CUATRO,
      );

      expect(r.final).toBe(true);
      expect(r.cambios).toEqual([
        { documentoId: 'doc-2041', estado: 'aceptado', detalleSii: null },
        { documentoId: 'doc-2053', estado: 'rechazado', detalleSii: rechazada },
        { documentoId: 'doc-2077', estado: 'reparos', detalleSii: reparo },
        { documentoId: 'doc-2090', estado: 'aceptado', detalleSii: null },
      ]);
      // Los dos errores de la rechazada llegan enteros.
      expect(
        (r.cambios[1].detalleSii as { error: unknown[] }).error,
      ).toHaveLength(2);
    });

    it('RPR en el envío es igual que EPR', () => {
      const reparo = { tipo: 39, folio: 2090, estado: 'RPR' };
      const r = repartirResultado(
        { estado: 'RPR', detalle_rep_rech: [reparo] },
        CUATRO,
      );
      expect(r.final).toBe(true);
      expect(r.cambios.map((c) => c.estado)).toEqual([
        'aceptado',
        'aceptado',
        'aceptado',
        'reparos',
      ]);
    });

    it('reparte por (tipo, folio): la 41 con el mismo folio no hereda el rechazo de la 39', () => {
      const rechazo = { tipo: 39, folio: 2053, estado: 'RCH' };
      const r = repartirResultado(
        { estado: 'EPR', detalle_rep_rech: [rechazo] },
        [B2053, B2053_41],
      );
      expect(r.cambios.map((c) => [c.documentoId, c.estado])).toEqual([
        ['doc-2053', 'rechazado'],
        ['doc-2053-41', 'aceptado'],
      ]);

      const al41 = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [{ tipo: 41, folio: 2053, estado: 'RPR' }],
        },
        [B2053, B2053_41],
      );
      expect(al41.cambios.map((c) => [c.documentoId, c.estado])).toEqual([
        ['doc-2053', 'aceptado'],
        ['doc-2053-41', 'reparos'],
      ]);
    });

    it('una entrada con folio null (error de esquema o de firma) alcanza a todas las boletas', () => {
      const deEsquema = {
        tipo: null,
        folio: null,
        estado: 'RCH',
        descripcion: 'Error de esquema',
        error: [error(1, 'XML mal formado')],
      };
      const r = repartirResultado(
        { estado: 'EPR', detalle_rep_rech: [deEsquema] },
        [...CUATRO, B2053_41],
      );
      expect(r.final).toBe(true);
      expect(r.cambios).toHaveLength(5);
      expect(r.cambios.every((c) => c.estado === 'rechazado')).toBe(true);
      expect(r.cambios.every((c) => c.detalleSii === deEsquema)).toBe(true);
    });

    it('una entrada con folio null y estado RPR deja a todas con reparos', () => {
      const r = repartirResultado(
        {
          estado: 'RPR',
          detalle_rep_rech: [{ tipo: null, folio: null, estado: 'RPR' }],
        },
        CUATRO,
      );
      expect(r.cambios.every((c) => c.estado === 'reparos')).toBe(true);
    });

    it('si a una boleta le tocan un reparo y un rechazo, manda el rechazo', () => {
      const reparo = { tipo: 39, folio: 2041, estado: 'RPR' };
      const rechazo = { tipo: 39, folio: 2041, estado: 'RCH' };
      const r = repartirResultado(
        { estado: 'EPR', detalle_rep_rech: [reparo, rechazo] },
        [B2041],
      );
      expect(r.cambios).toEqual([
        { documentoId: 'doc-2041', estado: 'rechazado', detalleSii: rechazo },
      ]);
    });

    it('el JSON del SII no está validado: una RCH sin la clave folio alcanza a todas', () => {
      const sinClave = { estado: 'RCH', descripcion: 'Error de firma' };
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [sinClave as never],
        },
        CUATRO,
      );
      expect(r.cambios.map((c) => c.estado)).toEqual([
        'rechazado',
        'rechazado',
        'rechazado',
        'rechazado',
      ]);
      expect(r.observaciones).toEqual([]);
    });

    it('folio y tipo como texto ("2053", "39") calzan con la boleta', () => {
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: '39', folio: '2053', estado: 'RCH' } as never,
          ],
        },
        [B2041, B2053, B2053_41],
      );
      expect(r.cambios.map((c) => [c.documentoId, c.estado])).toEqual([
        ['doc-2041', 'aceptado'],
        ['doc-2053', 'rechazado'],
        ['doc-2053-41', 'aceptado'],
      ]);
      expect(r.observaciones).toEqual([]);
    });

    it('un código de entrada que no es RCH ni RPR no deja la boleta en reparos: queda sin cambio, se avisa y nadie se acepta por silencio', () => {
      const desconocida = { tipo: 39, folio: 2077, estado: 'RLV' };
      const rechazo = { tipo: 39, folio: 2053, estado: 'RCH' };
      const r = repartirResultado(
        { estado: 'EPR', detalle_rep_rech: [desconocida, rechazo] },
        CUATRO,
      );
      expect(r.final).toBe(true);
      // La 2053 tiene su RCH y se reparte; la 2077 no cambia; las otras dos no tienen entrada
      // propia y, con algo que no se pudo leer en el sobre, tampoco se aceptan.
      expect(r.cambios).toEqual([
        { documentoId: 'doc-2053', estado: 'rechazado', detalleSii: rechazo },
      ]);
      expect(r.observaciones).toHaveLength(1);
      expect(r.observaciones[0]).toContain('código desconocido (RLV)');
      expect(r.observaciones[0]).toContain('folio 2077');
    });

    it('si a la misma boleta le tocan un código desconocido y un RCH, gana el RCH', () => {
      const rch = { tipo: 39, folio: 2077, estado: 'RCH' };
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [{ tipo: 39, folio: 2077, estado: 'RLV' }, rch],
        },
        [B2077],
      );
      expect(r.cambios).toEqual([
        { documentoId: 'doc-2077', estado: 'rechazado', detalleSii: rch },
      ]);
    });

    it('una entrada RCH o RPR que no calza con ninguna boleta se avisa, y las boletas sin entrada propia no se aceptan', () => {
      const conCalce = { tipo: 39, folio: 2090, estado: 'RPR' };
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: 39, folio: 9999, estado: 'RCH' },
            { tipo: 41, folio: 2041, estado: 'RPR' },
            conCalce,
          ],
        },
        CUATRO,
      );
      // Solo la que tiene su entrada se reparte; el resto queda enviado, a la vista.
      expect(r.cambios).toEqual([
        { documentoId: 'doc-2090', estado: 'reparos', detalleSii: conCalce },
      ]);
      expect(r.observaciones).toHaveLength(2);
      expect(r.observaciones[0]).toContain('RCH');
      expect(r.observaciones[1]).toContain('RPR');
    });

    it('un folio que no es número (NaN) no calza: se avisa y nadie se acepta', () => {
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: 39, folio: 'abc', estado: 'RCH' } as never,
          ],
        },
        CUATRO,
      );
      expect(r.cambios).toEqual([]);
      expect(r.observaciones).toHaveLength(1);
    });

    it('detalle_rep_rech presente pero que no es una lista: se avisa y nadie se acepta', () => {
      const r = repartirResultado(
        {
          estado: 'EPR',
          detalle_rep_rech: { folio: 2053, estado: 'RCH' } as never,
        },
        CUATRO,
      );
      expect(r.final).toBe(true);
      expect(r.cambios).toEqual([]);
      expect(r.observaciones).toEqual([
        expect.stringContaining('formato que no se entiende'),
      ]);
    });

    it('detalle_rep_rech null o ausente es "sin detalle": todas aceptadas, sin aviso', () => {
      for (const detalle of [undefined, null, []]) {
        const r = repartirResultado(
          { estado: 'EPR', detalle_rep_rech: detalle as never },
          CUATRO,
        );
        expect(r.cambios.map((c) => c.estado)).toEqual([
          'aceptado',
          'aceptado',
          'aceptado',
          'aceptado',
        ]);
        expect(r.observaciones).toEqual([]);
      }
    });

    it('solo reparte entre las boletas que se le pasan', () => {
      const r = repartirResultado({ estado: 'EPR' }, [B2077]);
      expect(r.cambios.map((c) => c.documentoId)).toEqual(['doc-2077']);
      expect(repartirResultado({ estado: 'EPR' }, []).cambios).toEqual([]);
    });
  });

  describe.each(['RCH', 'RCO', 'RFR', 'RSC', 'RCT', 'VOF'])(
    'rechazo del sobre (%s)',
    (codigo) => {
      it('todas rechazadas con el origen "sobre", el código y la glosa', () => {
        const r = repartirResultado(
          { estado: codigo, descripcion: 'Firma inválida' } as EstadoEnvioSii,
          CUATRO,
        );
        expect(r.final).toBe(true);
        expect(r.cambios).toHaveLength(4);
        for (const c of r.cambios) {
          expect(c.estado).toBe('rechazado');
          expect(c.detalleSii).toEqual({
            origen: 'sobre',
            estado: codigo,
            descripcion: 'Firma inválida',
          });
        }
      });
    },
  );

  it('un rechazo del sobre sin glosa deja la descripción en null', () => {
    const r = repartirResultado({ estado: 'RSC' }, [B2041]);
    expect(r.cambios[0].detalleSii).toEqual({
      origen: 'sobre',
      estado: 'RSC',
      descripcion: null,
    });
  });

  it('RPT: el envío termina y las boletas no cambian', () => {
    const r = repartirResultado({ estado: 'RPT' }, CUATRO);
    expect(r).toEqual({ final: true, cambios: [], observaciones: [] });
  });

  it.each(['REC', 'SOK', 'FOK', 'CRT', 'PRD'])(
    '%s: no es final, no toca ninguna boleta y no avisa',
    (codigo) => {
      const r = repartirResultado(
        {
          estado: codigo,
          detalle_rep_rech: [{ tipo: 39, folio: 2041, estado: 'RCH' }],
        },
        CUATRO,
      );
      expect(r).toEqual({ final: false, cambios: [], observaciones: [] });
    },
  );

  it.each(['XYZ', ''])(
    'el código desconocido %p: no es final, no toca ninguna boleta y avisa',
    (codigo) => {
      // Un código desconocido no puede dar por aceptada ni rechazada una boleta.
      const r = repartirResultado(
        {
          estado: codigo,
          detalle_rep_rech: [{ tipo: 39, folio: 2041, estado: 'RCH' }],
        },
        CUATRO,
      );
      expect(r.final).toBe(false);
      expect(r.cambios).toEqual([]);
      expect(r.observaciones).toEqual([
        `El SII devolvió el código ${codigo}; se sigue consultando`,
      ]);
    },
  );

  it('el código desconocido se recorta en el aviso', () => {
    const r = repartirResultado({ estado: 'X'.repeat(80) }, CUATRO);
    expect(r.observaciones[0]).toBe(
      `El SII devolvió el código ${'X'.repeat(20)}; se sigue consultando`,
    );
  });
});
