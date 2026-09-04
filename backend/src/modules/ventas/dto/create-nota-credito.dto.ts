import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class DevolucionNotaCreditoDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  /**
   * ¿Vuelve al stock? Ausente = repone **si el ítem puede**, que es la conducta
   * de antes de este campo. Para lo que no puede reponer —servicios, recetas,
   * combos, y los modos `serie`/`lote`— pedirlo explícitamente se rechaza, para
   * no confirmar en silencio algo que no pasó.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;
}

export class CreateNotaCreditoDto {
  // El service ya rechaza monto <= 0 (crearNotaCredito); se refuerza en el DTO.
  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  monto: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  /** Registra un movimiento de salida en la caja física abierta del usuario. */
  @IsOptional()
  @IsBoolean()
  devolverDinero?: boolean;

  /**
   * Ítems que se ACREDITAN en la nota, con su reposición como propiedad de cada
   * línea. Hasta el 2026-09-04 significaba "ítems a devolver a stock" y por eso
   * solo admitía modo `cantidad`: hoy cualquier ítem vendido entra, y lo que
   * `modo_inventario` decide es únicamente si puede volver al inventario.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionNotaCreditoDto)
  devoluciones?: DevolucionNotaCreditoDto[];
}
