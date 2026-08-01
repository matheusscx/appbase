import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RestaurarDto } from './restaurar.dto';

// `POST /<recurso>/:id/restaurar` no tenía body hasta la salida de colisión
// (owner, 2026-08-01). Lo que este spec fija es que agregarlo NO cambió las
// llamadas que ya existían: 12 pantallas y el e2e llaman sin body, y con
// `ValidationPipe({ whitelist: true, transform: true })` un DTO mal declarado
// las rompería a todas.
describe('RestaurarDto', () => {
  it('sin body es válido y deja `nombre` undefined (el caso de siempre)', async () => {
    const dto = plainToInstance(RestaurarDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.nombre).toBeUndefined();
  });

  it('con un nombre válido lo conserva', async () => {
    const dto = plainToInstance(RestaurarDto, { nombre: 'Black Friday 2' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.nombre).toBe('Black Friday 2');
  });

  it('recorta los espacios de los bordes', async () => {
    // La unicidad se compara EXACTA contra la columna, así que " X " y "X"
    // competirían distinto y el usuario podría dejar dos nombres que se ven
    // iguales en pantalla.
    const dto = plainToInstance(RestaurarDto, { nombre: '  Black Friday 2  ' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.nombre).toBe('Black Friday 2');
  });

  it('rechaza el string vacío', async () => {
    const dto = plainToInstance(RestaurarDto, { nombre: '' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rechaza un nombre de solo espacios (el trim corre ANTES de validar)', async () => {
    // Sin el `@Transform`, "   " pasaría `@IsNotEmpty` y restauraría la fila
    // con un nombre en blanco.
    const dto = plainToInstance(RestaurarDto, { nombre: '   ' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rechaza un nombre que no es string', async () => {
    const dto = plainToInstance(RestaurarDto, { nombre: 42 });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
