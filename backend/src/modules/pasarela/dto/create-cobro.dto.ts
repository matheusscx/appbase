import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCobroDto {
  @IsOptional()
  @IsUUID()
  inscripcionId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^\S+$/)
  pagadorRef?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  referenciaExterna?: string;

  @IsNumberString()
  monto: string;

  @IsString()
  @Length(1, 255)
  descripcion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(48)
  cuotas?: number;
}
