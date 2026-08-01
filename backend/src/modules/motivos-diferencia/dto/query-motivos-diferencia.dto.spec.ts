import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMotivosDiferenciaDto } from './query-motivos-diferencia.dto';

// El controller pasaba `soloActivas === 'true'` a mano antes de esta tarea:
// cualquier string que no fuera exactamente 'true' resultaba en `false`, y
// el parámetro ausente también. Este spec prueba que moverlo a un DTO con
// `@Transform` no cambió ese comportamiento (mismo spec que
// mermas/dto/query-causas-merma.dto.spec.ts, misma familia).
describe('QueryMotivosDiferenciaDto', () => {
  it('soloActivas=true se parsea como boolean true', async () => {
    const dto = plainToInstance(QueryMotivosDiferenciaDto, {
      soloActivas: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
  });

  it('soloActivas=false se parsea como boolean false', async () => {
    const dto = plainToInstance(QueryMotivosDiferenciaDto, {
      soloActivas: 'false',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('un valor que no es exactamente "true" se parsea como false (igual que `=== "true"` antes)', async () => {
    const dto = plainToInstance(QueryMotivosDiferenciaDto, {
      soloActivas: 'cualquier-cosa',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('sin el parámetro, soloActivas queda falsy', async () => {
    const dto = plainToInstance(QueryMotivosDiferenciaDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBeFalsy();
  });

  it('acepta soloActivas e incluirEliminados combinados (el campo heredado sigue funcionando)', async () => {
    const dto = plainToInstance(QueryMotivosDiferenciaDto, {
      soloActivas: 'true',
      incluirEliminados: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
    expect(dto.incluirEliminados).toBe(true);
  });
});
