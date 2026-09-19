import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMyTenantDto {
  // `nombre` es la identidad del tenant y sale en documentos: dejarlo sin
  // nombre no es un estado válido. Mismo patrón de tres decoradores que
  // `UpdateMotivoBajaDto` (`motivos-baja/dto/update-motivo-baja.dto.ts`, que lo
  // documenta en detalle) — ninguno de los tres cubre a los otros dos:
  // `@Transform` trimea ANTES de validar (patrón de `RestaurarDto`) para que
  // `@IsNotEmpty()` rechace también `'   '`, no solo `''`; y `@ValidateIf`
  // en vez de `@IsOptional()` porque `IsOptional` trata `null` igual que
  // ausente y saltea TODOS los validadores — acá `updateMine()` hace
  // `Object.assign(tenant, dto)` sin volver a chequear, así que un
  // `{"nombre": null}` llegaría directo a una columna NOT NULL: 500 crudo de
  // Postgres en vez de un 400.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  // `correo` y `provinciaId` son columnas NOT NULL igual que `nombre`, así que
  // llevan el mismo `@ValidateIf`: con `@IsOptional()`, un `null` se salteaba
  // `@IsEmail`/`@IsUUID` y terminaba en el mismo 500 de Postgres. No llevan
  // `@IsNotEmpty()` ni `@Transform` porque `@IsEmail`/`@IsUUID` ya rechazan
  // `''` y `'   '` por su cuenta — el trío completo es para los campos de
  // texto libre.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsEmail()
  correo?: string;

  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsUUID()
  provinciaId?: string;

  // ⚠️ `telefono` y `direccion` SÍ conservan `@IsOptional()`, y no es un olvido:
  // sus columnas son nullables, así que mandar `null` es la forma legítima de
  // **borrar** el dato. Su tipo lo declara (`string | null`). La asimetría
  // dentro de este archivo sigue exactamente la nulabilidad de cada columna.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;

  // Hora local (0–6) a la que termina el día del negocio. `@ValidateIf` y no
  // `@IsOptional()`, por lo mismo que `nombre`: la columna es NOT NULL y un
  // `null` saltearía los validadores hasta el 500 de Postgres. Horas enteras y
  // solo de madrugada, por decisión del owner (spec de la hora de corte, § 2):
  // un corte de tarde pasaría ventas de la tarde al día anterior.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(6)
  horaCorte?: number;
}
