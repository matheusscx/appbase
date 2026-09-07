import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMotivosTrasladoDto } from './query-motivos-traslado.dto';

// Mismo spec que mermas/dto/query-causas-merma.dto.spec.ts y
// motivos-diferencia-inventario/dto/query-motivos-diferencia-inventario.dto.spec.ts,
// misma familia: prueba que `@Transform` no cambió el comportamiento de
// `soloActivas === 'true'` a mano.
describe('QueryMotivosTrasladoDto', () => {
  it('soloActivas=true se parsea como boolean true', async () => {
    const dto = plainToInstance(QueryMotivosTrasladoDto, {
      soloActivas: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
  });

  it('soloActivas=false se parsea como boolean false', async () => {
    const dto = plainToInstance(QueryMotivosTrasladoDto, {
      soloActivas: 'false',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('un valor que no es exactamente "true" se parsea como false (igual que `=== "true"` antes)', async () => {
    const dto = plainToInstance(QueryMotivosTrasladoDto, {
      soloActivas: 'cualquier-cosa',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('sin el parámetro, soloActivas queda falsy', async () => {
    const dto = plainToInstance(QueryMotivosTrasladoDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBeFalsy();
  });

  it('acepta soloActivas e incluirEliminados combinados (el campo heredado sigue funcionando)', async () => {
    const dto = plainToInstance(QueryMotivosTrasladoDto, {
      soloActivas: 'true',
      incluirEliminados: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
    expect(dto.incluirEliminados).toBe(true);
  });
});
