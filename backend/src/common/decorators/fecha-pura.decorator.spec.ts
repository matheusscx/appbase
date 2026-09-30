import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EsFechaOTimestamp, EsFechaPura } from './fecha-pura.decorator';

class FechaPuraDto {
  @EsFechaPura()
  fecha: string;
}

class FechaOTimestampDto {
  @EsFechaOTimestamp()
  fecha: string;
}

const erroresDe = async (
  clase: typeof FechaPuraDto | typeof FechaOTimestampDto,
  fecha: unknown,
) => validate(plainToInstance(clase, { fecha }));

// Lo que llega crudo al SQL: cada rechazo de acá era un 500 de Postgres (22007 o
// 22008) antes de que existieran estos decoradores.
describe('EsFechaPura', () => {
  it.each(['2026-09-30', '2024-02-29'])('acepta %s', async (fecha) => {
    expect(await erroresDe(FechaPuraDto, fecha)).toHaveLength(0);
  });

  it.each([
    '2026-02-31', // no existe en el calendario
    '2025-02-29', // no es bisiesto
    '2026-13-01',
    '2026-08', // sin día
    '20260807', // sin guiones
    '2026-W32-1', // semana ISO
    '2026-09-30T10:00:00Z', // timestamp a una columna `date`
    ' 2026-09-30',
  ])('rechaza %s', async (fecha) => {
    expect(await erroresDe(FechaPuraDto, fecha)).not.toHaveLength(0);
  });

  it.each([
    ['arreglo', ['2026-09-30']],
    ['número', 20260930],
  ])('rechaza un %s', async (_, fecha) => {
    expect(await erroresDe(FechaPuraDto, fecha)).not.toHaveLength(0);
  });
});

describe('EsFechaOTimestamp', () => {
  it.each([
    '2026-09-30',
    '2026-09-30T10:00',
    '2026-09-30T10:00:00',
    '2026-09-30T10:00:00.123Z',
    '2026-09-30T10:00:00-03:00',
    '2026-09-30T10:00:00+0300',
  ])('acepta %s', async (fecha) => {
    expect(await erroresDe(FechaOTimestampDto, fecha)).toHaveLength(0);
  });

  it.each([
    '2026-02-31',
    '2026-02-31T10:00:00Z',
    '2026-08',
    '20260807',
    '2026-W32-1',
    '2026-09-30T25:00:00Z',
    '2026-09-30T10:00:00+99:99',
    '2026-09-30 10:00:00', // espacio en vez de `T`
    '2026-09-30\n',
  ])('rechaza %s', async (fecha) => {
    expect(await erroresDe(FechaOTimestampDto, fecha)).not.toHaveLength(0);
  });
});
