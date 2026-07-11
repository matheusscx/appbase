import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReembolsoDto } from './create-reembolso.dto';

async function validar(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateReembolsoDto, payload));
}

describe('CreateReembolsoDto', () => {
  it('acepta el payload mínimo actual (solo monto) — regresión', async () => {
    const errores = await validar({ monto: '1100' });
    expect(errores).toHaveLength(0);
  });

  it('acepta NC y devoluciones válidas', async () => {
    const errores = await validar({
      monto: '1100',
      generarNotaCredito: true,
      devoluciones: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440116',
          cantidad: '2',
        },
      ],
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza devoluciones con itemId no UUID', async () => {
    const errores = await validar({
      monto: '1100',
      devoluciones: [{ itemId: 'no-es-uuid', cantidad: '2' }],
    });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza devoluciones con cantidad no numérica', async () => {
    const errores = await validar({
      monto: '1100',
      devoluciones: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440116',
          cantidad: 'dos',
        },
      ],
    });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza generarNotaCredito no booleano', async () => {
    const errores = await validar({ monto: '1100', generarNotaCredito: 'si' });
    expect(errores.length).toBeGreaterThan(0);
  });
});
