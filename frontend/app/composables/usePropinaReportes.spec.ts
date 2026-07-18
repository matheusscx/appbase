import { describe, expect, it } from 'vitest';
import {
  claveCachePropinaReportes,
  crearCachePropinaReportes,
  serializarFiltrosReporte,
  tipoTrabajadorDesdeSelect,
  tipoTrabajadorParaSelect,
  type PropinaReporteResumen,
} from './usePropinaReportes';

describe('serializarFiltrosReporte', () => {
  it('serializa fechas calendario, ordena turnos y omite filtros vacíos', () => {
    expect(
      serializarFiltrosReporte({
        desde: '2026-07-01',
        hasta: '2026-07-31',
        turnoIds: ['b', 'a'],
      }),
    ).toEqual({
      desde: '2026-07-01',
      hasta: '2026-08-01',
      turnoIds: 'a,b',
    });
  });

  it('incluye el tipo cuando está seleccionado', () => {
    expect(
      serializarFiltrosReporte({
        desde: '2026-07-01',
        hasta: '2026-07-01',
        turnoIds: [],
        tipoGarzon: 'cocina',
      }),
    ).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-02',
      tipoGarzon: 'cocina',
    });
  });

  it('rechaza filtros incompletos, invertidos o imposibles', () => {
    expect(() =>
      serializarFiltrosReporte({ desde: '', hasta: '', turnoIds: [] }),
    ).toThrow('Selecciona un rango de fechas');
    expect(() =>
      serializarFiltrosReporte({
        desde: '2026-07-02',
        hasta: '2026-07-01',
        turnoIds: [],
      }),
    ).toThrow('La fecha hasta debe ser igual o posterior a desde');
    expect(() =>
      serializarFiltrosReporte({
        desde: '2026-02-30',
        hasta: '2026-03-01',
        turnoIds: [],
      }),
    ).toThrow('Las fechas deben usar YYYY-MM-DD');
  });
});

describe('crearCachePropinaReportes', () => {
  it('separa las claves por tenant', () => {
    const filtros = {
      desde: '2026-07-01',
      hasta: '2026-07-31',
      turnoIds: [],
    };

    expect(claveCachePropinaReportes('tenant-a', filtros)).not.toBe(
      claveCachePropinaReportes('tenant-b', filtros),
    );
  });

  it('cachea cada tab por clave y clear invalida ambos', () => {
    const cache = crearCachePropinaReportes();
    const resumen = { periodo: { desde: 'a', hasta: 'b' } } as PropinaReporteResumen;

    cache.set('resumen', 'clave', resumen);

    expect(cache.get('resumen', 'clave')).toBe(resumen);
    expect(cache.get('trabajadores', 'clave')).toBeUndefined();
    cache.clear();
    expect(cache.get('resumen', 'clave')).toBeUndefined();
  });
});

describe('selector de tipo de trabajador', () => {
  it('usa un valor no vacío para representar todos', () => {
    expect(tipoTrabajadorParaSelect(undefined)).toBe('todos');
    expect(tipoTrabajadorDesdeSelect('todos')).toBeUndefined();
    expect(tipoTrabajadorDesdeSelect('cocina')).toBe('cocina');
  });
});
