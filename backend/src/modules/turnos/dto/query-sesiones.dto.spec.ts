import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuerySesionesDto } from './query-sesiones.dto';

// El historial castea estas fechas con `$N::date`. `@IsDateString()` aceptaba
// formatos ISO que ese cast rechaza con un 22007, o sea un 500 genérico donde
// correspondía un 400 que dice qué corregir.
describe('QuerySesionesDto — desde/hasta son fecha pura', () => {
  it('acepta YYYY-MM-DD, que es lo que emite AppDateInput', async () => {
    const dto = plainToInstance(QuerySesionesDto, {
      desde: '2026-08-01',
      hasta: '2026-08-31',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['2026-08', '2026-W32-1', '20260807', '2026-08-07T21:00:00Z'])(
    'rechaza %s con un 400, no lo deja llegar al ::date',
    async (valor) => {
      const errores = await validate(
        plainToInstance(QuerySesionesDto, { hasta: valor }),
      );
      expect(errores).toHaveLength(1);
      expect(errores[0]?.constraints).toHaveProperty('matches');
    },
  );

  // La otra mitad, y la que el regex NO puede ver: tiene la forma correcta pero
  // no es una fecha. El `::date` las rechaza con 22008 → 500, así que el 400
  // tiene que salir del DTO. `2026-02-31` es el caso filoso: es ISO válido, y
  // pasaba también con el `@IsDateString()` que había antes.
  it.each(['2026-13-45', '2026-08-45', '2026-02-31', '2026-00-10'])(
    'rechaza %s: tiene la forma YYYY-MM-DD pero no existe en el calendario',
    async (valor) => {
      const errores = await validate(
        plainToInstance(QuerySesionesDto, { hasta: valor }),
      );
      expect(errores).toHaveLength(1);
      expect(errores[0]?.constraints).toHaveProperty('isIso8601');
    },
  );

  it('ambas siguen siendo opcionales', async () => {
    expect(await validate(plainToInstance(QuerySesionesDto, {}))).toHaveLength(
      0,
    );
  });
});
