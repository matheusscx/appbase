import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ModoRegla, NivelRegla } from '../../../common/enums/reglas.enums';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

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
  // `@IsEnum`: la columna es el enum `modo_regla` de Postgres, y un valor que no
  // es de él pasaba el DTO y daba 500 en el INSERT (2026-10-08).
  @IsOptional()
  @IsEnum(ModoRegla)
  modo?: string | null;

  // `@ArrayUnique` no es cosmético: la lista se guarda con un
  // `INSERT … ON CONFLICT DO UPDATE`, que en Postgres no puede tocar la misma
  // fila dos veces en una sentencia (21000). Sin esto, un id repetido cortaba
  // con un 500 —en `POST` desde siempre, por la PK compuesta de la puente—.
  // Mismo decorador que usan las listas de ids de `propinas` y `recuentos`.
  @IsOptional()
  @IsArray()
  // Catálogo global de medios de pago (hoy 4); `@ArrayUnique` ya no deja
  // repetir.
  @ArrayMaxSize(20)
  // En minúsculas antes del `@ArrayUnique`: `[x, X]` pasaba como dos ids y la
  // puente recibía la misma fila dos veces (500, medido el 2026-10-08).
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  metodoPagoIds?: string[];

  @IsOptional()
  @IsArray()
  // Tramos por volumen de una regla: una escala, no un catálogo.
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => TramoDto)
  tramos?: TramoDto[];

  // `@Max(9999)`: el tope del formulario de reglas
  // (`frontend/app/utils/reglas-form-config.ts`, `diasMax`). Se guarda como
  // texto en `condicion_valor` y se lee con `parseInt`: sin tope, `1e21` se
  // guardaba como "1e+21" y se leía como 1 (2026-10-08). La mora tiene además
  // su 0-365 en el service.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  diasVencimiento?: number;

  // `descuentos.fecha_inicio`/`fecha_fin` son `date`: fecha pura estricta,
  // no `@IsDateString` (que aceptaría un timestamp que la columna no guarda).
  @IsOptional()
  @EsFechaPura()
  fechaInicio?: string | null;

  @IsOptional()
  @EsFechaPura()
  fechaFin?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /**
   * Dónde se aplica la regla. Opcional y con default `linea` en el service: la
   * API vieja no lo mandaba y todo lo que existe es de línea, así que omitirlo
   * conserva el significado en vez de inventar uno.
   */
  @IsOptional()
  @IsEnum(NivelRegla)
  nivel?: NivelRegla;
}
