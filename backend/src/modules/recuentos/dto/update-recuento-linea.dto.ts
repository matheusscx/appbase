import { IsNumberString, IsOptional, IsUUID } from 'class-validator';
import { IsDecimalPersistible } from '../../../common/decorators/decimal-signo.decorator';
import { EsCantidad } from '../../../common/decorators/escala-moneda.decorator';

export class UpdateRecuentoLineaDto {
  // null explícito limpia el conteo cargado; undefined deja la línea sin tocar.
  @IsOptional()
  @IsNumberString()
  @IsDecimalPersistible(18, 4)
  @EsCantidad('La cantidad contada admite como máximo 4 decimales.')
  cantidadContada?: string | null;

  // null explícito limpia el override de causa de la línea (vuelve a usar la
  // causa por defecto de la sesión); undefined deja la línea sin tocar.
  @IsOptional()
  @IsUUID()
  motivoDiferenciaId?: string | null;
}
