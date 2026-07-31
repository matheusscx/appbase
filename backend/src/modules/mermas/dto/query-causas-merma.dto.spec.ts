import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryCausasMermaDto } from './query-causas-merma.dto';

// El controller pasaba `soloActivas === 'true'` a mano antes de esta tarea:
// cualquier string que no fuera exactamente 'true' resultaba en `false`, y
// el parámetro ausente también. Este spec prueba que moverlo a un DTO con
// `@Transform` no cambió ese comportamiento — es lo que pidió la revisión.
describe('QueryCausasMermaDto', () => {
  it('soloActivas=true se parsea como boolean true', async () => {
    const dto = plainToInstance(QueryCausasMermaDto, { soloActivas: 'true' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
  });

  it('soloActivas=false se parsea como boolean false', async () => {
    const dto = plainToInstance(QueryCausasMermaDto, {
      soloActivas: 'false',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('un valor que no es exactamente "true" se parsea como false (igual que `=== "true"` antes)', async () => {
    const dto = plainToInstance(QueryCausasMermaDto, {
      soloActivas: 'cualquier-cosa',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(false);
  });

  it('sin el parámetro, soloActivas queda falsy', async () => {
    const dto = plainToInstance(QueryCausasMermaDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBeFalsy();
  });

  it('acepta soloActivas e incluirEliminados combinados (el campo heredado sigue funcionando)', async () => {
    const dto = plainToInstance(QueryCausasMermaDto, {
      soloActivas: 'true',
      incluirEliminados: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.soloActivas).toBe(true);
    expect(dto.incluirEliminados).toBe(true);
  });
});
