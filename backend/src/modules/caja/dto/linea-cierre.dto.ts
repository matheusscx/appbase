import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class LineaCierreDto {
  // null = la línea de efectivo agregada.
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  metodoPagoId: string | null;

  // Admite decimales (dinero = Decimal.js). NO usar { no_symbols: true }: rechaza
  // el punto decimal y rompió 6 e2e el 2026-07-23.
  @IsNumberString()
  montoContado: string;

  @IsOptional()
  @IsUUID('4')
  motivoDiferenciaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentarioDiferencia?: string;
}
