import { IsNumberString, IsUUID, ValidateIf } from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class LineaCierreDto {
  // null = la línea de efectivo agregada.
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  metodoPagoId: string | null;

  // Admite decimales (dinero = Decimal.js). NO usar { no_symbols: true }: rechaza
  // el punto decimal y rompió 6 e2e el 2026-07-23.
  // 0 es legítimo (ese método no tuvo movimiento); nunca negativo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  montoContado: string;
}
