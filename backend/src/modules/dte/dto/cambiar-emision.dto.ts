import { IsBoolean } from 'class-validator';

/** Enciende (`true`) o apaga (`false`) la boleta electrónica por venta del tenant. */
export class CambiarEmisionDto {
  @IsBoolean()
  activa: boolean;
}
