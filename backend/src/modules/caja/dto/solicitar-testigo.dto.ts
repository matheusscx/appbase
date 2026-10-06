import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** El encargado elige a quién pedirle fe del conteo ya congelado. */
export class SolicitarTestigoDto {
  @IsArray()
  // Garzones con sesión abierta; el service hace un INSERT por id.
  @ArrayMaxSize(100)
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  garzonIds: string[];
}
