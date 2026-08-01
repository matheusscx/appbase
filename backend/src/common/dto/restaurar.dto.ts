import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Body opcional de `POST /<recurso>/:id/restaurar` en los recursos con
 * unicidad de nombre por tenant.
 *
 * Lo usan los **8 controllers** de recursos con unicidad de nombre por tenant
 * (`descuentos`, `recargos`, `turnos`, `cajones`, `causas-merma`,
 * `motivos-diferencia`, `motivos-diferencia-inventario`,
 * `grupos-modificadores`). Vive en `common/` por la misma razón que
 * [`QueryIncluirEliminadosDto`](./query-incluir-eliminados.dto.ts): el nombre
 * del campo es contrato entre esos 8 y las pantallas que los llaman, y si cada
 * módulo lo escribiera por su cuenta, dos podrían discrepar sin error visible.
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
