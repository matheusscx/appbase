import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /compras/:id/anular` (spec compras-recepcion § 4.5). El motivo
 * es obligatorio: una anulación saca del stock todo lo que entró y cambia el
 * costo, y la compra queda a la vista, tachada, con el porqué.
 */
export class AnularCompraDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motivo: string;
}
