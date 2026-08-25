import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class TramoDto {
  // El mínimo va en UNA de las dos, y cuál corresponde lo decide el TIPO de la
  // regla, que un decorador no puede leer — igual que pasa con el importe y su
  // `modo`. Lo valida `validarMinimosDeTramos` en el service.
  // `minimoMonto` es el que el borde de escala PUEDE marcar: un umbral en plata
  // tiene que caber en la moneda del tenant. `minimoCantidad` no lleva marca
  // porque sus decimales son legítimos (2,5 kg).
  @IsOptional()
  @IsNumberString()
  minimoCantidad?: string | null;

  @IsOptional()
  @IsNumberString()
  @EsMontoCobrado()
  minimoMonto?: string | null;

  // Exactamente una de las dos, y la que corresponde al `modo` de la regla: lo
  // valida el service. Acá van opcionales porque cuál corresponde no se sabe
  // sin mirar el hermano `modo`, que un decorador no puede leer.
  // `valorMonto` es lo que el borde de escala PUEDE marcar ahora que existe
  // como campo propio; el pipe que lo hace efectivo se enchufa aparte.
  @IsOptional()
  @IsNumberString()
  @EsMontoCobrado()
  valorMonto?: string | null;

  @IsOptional()
  @IsNumberString()
  valorPorcentaje?: string | null;
}

export class CreateDescuentoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsUUID()
  tipoReglaId: string;

  // El importe va en UNA de las dos, la que dice `modo`; que un tipo lo EXIJA
  // lo decide el service. Una regla por tramos no manda ninguna de las dos.
  @IsOptional()
  @IsNumberString()
  @EsMontoCobrado()
  valorMonto?: string | null;

  @IsOptional()
  @IsNumberString()
  valorPorcentaje?: string | null;

  // modo is optional at DTO level; service validates by tipo
  @IsOptional()
  @IsString()
  modo?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  metodoPagoIds?: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TramoDto)
  tramos?: TramoDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  diasVencimiento?: number;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string | null;

  @IsOptional()
  @IsDateString()
  fechaFin?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
