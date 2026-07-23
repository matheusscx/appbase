import { IsNumberString, IsOptional } from 'class-validator';

/**
 * Propina cargada desde el POS (venta directa). No lleva garzón: el service la
 * atribuye al placeholder "Mostrador" del tenant con atribución neutra. Ver
 * docs/features/pagos.md.
 */
export class PropinaDirectaDto {
  @IsNumberString()
  montoPagado: string;

  @IsOptional()
  @IsNumberString()
  montoSugerido?: string;

  @IsOptional()
  @IsNumberString()
  porcentajeSugerido?: string;
}
