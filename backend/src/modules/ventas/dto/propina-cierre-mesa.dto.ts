import {
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { EstrategiaAsignacionPropina } from '../../propinas/enums/estrategia-asignacion-propina.enum';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class PropinaCierreMesaDto {
  // 0 es un estado real ("sin propina" al cerrar mesa, ver
  // venta-propina.service.ts EstadoVentaPropina.SIN_PROPINA), nunca negativo.
  @IsNumberString()
  @IsDecimalNoNegativo()
  montoPagado: string;

  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  montoSugerido?: string;

  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
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
