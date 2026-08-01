import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Body opcional de `POST /<recurso>/:id/restaurar` en los recursos con
 * unicidad de nombre por tenant.
 *
 * ⚠️ **Hoy lo usa UN solo controller: `descuentos`.** Vive en `common/` por la
 * misma razón que
 * [`QueryIncluirEliminadosDto`](./query-incluir-eliminados.dto.ts): el nombre
 * del campo va a ser contrato entre los 8 recursos con unicidad de nombre y la
 * pantalla que los llama, y si cada módulo lo escribiera por su cuenta, dos
 * podrían discrepar sin error visible. Los otros 7 quedan en
 * `docs/agent/pendientes.md`.
 *
 * **Sin body, o sin `nombre`, el comportamiento es el de siempre**: se
 * restaura con el nombre que la fila ya tenía. `nombre` solo se manda cuando
 * el usuario resolvió una colisión desde el modal, así que agregar este DTO no
 * cambia ninguna llamada existente.
 */
export class RestaurarDto {
  // `trim` antes de validar: " " tiene que fallar el @IsNotEmpty igual que "",
  // y un nombre con espacios al borde no debe competir distinto en la
  // comparación de unicidad, que es exacta.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;
}
