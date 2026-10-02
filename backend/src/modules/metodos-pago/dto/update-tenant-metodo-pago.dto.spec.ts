import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantMetodoPagoDto } from './update-tenant-metodo-pago.dto';

// `emisor` es NOT NULL con default 'sistema' (E3): `@ValidateIf` y no
// `@IsOptional()`, porque con `null` este último saltea `@IsIn` y el valor
// llegaría a la columna como un 500 de Postgres en vez de un 400.
async function errores(payload: Record<string, unknown>): Promise<string[]> {
  const res = await validate(
    plainToInstance(UpdateTenantMetodoPagoDto, payload),
  );
  return res.map((e) => e.property);
}

describe('UpdateTenantMetodoPagoDto — emisor', () => {
  it.each(['sistema', 'maquina', 'nadie'])('acepta %p', async (emisor) => {
    await expect(errores({ emisor })).resolves.toEqual([]);
  });

  it.each(['externo', '', 'MAQUINA', 1, null])('rechaza %p', async (emisor) => {
    await expect(errores({ emisor })).resolves.toEqual(['emisor']);
  });

  it('ausente no se valida: un PATCH de solo habilitada sigue valiendo', async () => {
    await expect(errores({ habilitada: true })).resolves.toEqual([]);
  });
});
