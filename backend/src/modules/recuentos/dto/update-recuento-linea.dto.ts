import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class UpdateRecuentoLineaDto {
  // null explícito limpia el conteo cargado; undefined deja la línea sin tocar.
  @IsOptional()
  @IsNumberString()
  cantidadContada?: string | null;

  @IsOptional()
  @IsUUID()
  motivoDiferenciaId?: string;
}
