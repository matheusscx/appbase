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

  it('acepta devoluciones válidas', async () => {
    const errores = await validar({
      monto: '1100',
      devoluciones: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440116',
          cantidad: '2',
        },
      ],
    });
    expect(errores).toHaveLength(0);
  });

  it('acepta reponerStock por línea, y lo rechaza si no es booleano', async () => {
    // El campo tiene que estar declarado ACÁ o el pipe global rechaza el body
    // con 400 y la política del webhook queda inalcanzable.
    const ok = await validar({
      monto: '1100',
      devoluciones: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440116',
          cantidad: '2',
          reponerStock: false,
        },
      ],
    });
    expect(ok).toHaveLength(0);

    const mal = await validar({
      monto: '1100',
      devoluciones: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440116',
          cantidad: '2',
          reponerStock: 'no',
        },
      ],
    });
    expect(mal.length).toBeGreaterThan(0);
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

  it('acota el largo de devoluciones: 200 pasan, 201 no', async () => {
    const linea = {
      itemId: '550e8400-e29b-41d4-a716-446655440116',
      cantidad: '1',
    };
    const ok = await validar({
      monto: '1100',
      devoluciones: Array.from({ length: 200 }, () => linea),
    });
    const mal = await validar({
      monto: '1100',
      devoluciones: Array.from({ length: 201 }, () => linea),
    });
    expect(ok).toHaveLength(0);
    expect(mal.some((e) => e.property === 'devoluciones')).toBe(true);
  });
});
