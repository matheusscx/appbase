import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** El encargado elige a quién pedirle fe del conteo ya congelado. */
export class SolicitarTestigoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  garzonIds: string[];
}
