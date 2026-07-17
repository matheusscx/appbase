import { IsEnum, IsIn, IsNumberString, IsOptional, IsUUID } from 'class-validator';
import { EstrategiaAsignacionPropina } from '../../propinas/enums/estrategia-asignacion-propina.enum';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';

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

  @IsOptional()
  @IsUUID()
  sesionGarzonId?: string;

  @IsOptional()
  @IsUUID()
  turnoId?: string;

  @IsOptional()
  @IsIn(Object.values(TipoGarzon))
  tipoGarzon?: TipoGarzon;
}
