import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNumberString,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import { AjustesRepartoDto } from './ajustes-reparto.dto';

/** Lo que una persona del reparto mostrado iba a recibir. */
export class MontoEsperadoDto {
  @IsUUID()
  garzonId: string;

  // Como `poolEsperado`: solo se compara, no se guarda.
  @IsNumberString()
  @IsDecimalNoNegativo()
  monto: string;
}

export class LiquidarDto {
  // Ver `create-liquidacion.dto.ts`: `strict` cierra el rollover de calendario,
  // `rangoLiquidacion` cierra la fecha que `new Date` no sabe leer.
  @IsISO8601({ strict: true })
  fechaDesde: string;

  @IsISO8601({ strict: true })
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  // Mismo tope que `CreateLiquidacionDto.turnoIds`.
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  // `IsObject` además de `ValidateNested`: este deja pasar un array, y la
  // liquidación se confirmaba sin las exclusiones ni los montos pedidos.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AjustesRepartoDto)
  ajustes?: AjustesRepartoDto;

  // El fondo del reparto que la persona vio y confirmó. Se liquida solo si el
  // recalculado es ese mismo monto (owner, 2026-10-16, por AskUserQuestion de la
  // orquestadora: "Avisar y no liquidar"). Solo se compara, no se guarda: por eso
  // no lleva `@IsMontoPersistible` ni escala de moneda (llega como lo dio el preview).
  @IsNumberString()
  @IsDecimalNoNegativo()
  poolEsperado: string;

  // Quién recibe y cuánto, en el reparto que se vio: las personas incluidas. Si el
  // recalculado reparte distinto —entró o salió alguien de turno, aunque el fondo sea
  // el mismo—, no se liquida (owner, 2026-10-16, por AskUserQuestion de la
  // orquestadora: "Avisar también si cambió el reparto"). Tope: el de `exclusiones`,
  // a lo sumo los garzones del tenant.
  @IsArray()
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => MontoEsperadoDto)
  repartoEsperado: MontoEsperadoDto[];
}
