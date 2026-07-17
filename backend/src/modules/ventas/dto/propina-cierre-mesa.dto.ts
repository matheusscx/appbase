import { IsEnum, IsNumberString, IsOptional, IsUUID } from 'class-validator';
import { EstrategiaAsignacionPropina } from '../../propinas/enums/estrategia-asignacion-propina.enum';

export class PropinaCierreMesaDto {
  @IsNumberString()
  montoPagado: string;

  @IsOptional()
  @IsNumberString()
  montoSugerido?: string;

  @IsOptional()
  @IsNumberString()
  porcentajeSugerido?: string;

  @IsUUID()
  garzonId: string;

  @IsOptional()
  @IsEnum(EstrategiaAsignacionPropina)
  estrategia?: EstrategiaAsignacionPropina;
}
