import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMermaDto {
  @IsUUID()
  itemId: string;

  // Requerido, no opcional-con-default: un default silencioso mete la merma en
  // el local cada vez que alguien se olvide de elegir, y el olvido es invisible
  // en un tenant de una sola ubicación — el chokepoint lo exige
  // (`RegistrarMovimientoParams.ubicacionId`, `inventario.service.ts`).
  // Antes de que la merma pidiera
  // ubicación el valor salía de `UbicacionesService.localDe(tenantId)`; ahora
  // lo elige quien registra la merma, porque el lugar acota qué se pudrió
  // *ahí*.
  @IsUUID()
  ubicacionId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsOptional()
  unidadCodigo?: string;

  @IsUUID()
  causaMermaId: string;

  @IsString()
  @IsOptional()
  comentario?: string;
}
