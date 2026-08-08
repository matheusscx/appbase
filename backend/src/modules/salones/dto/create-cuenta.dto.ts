import { IsOptional, IsString } from 'class-validator';
import { CredencialGarzonDto } from '../../../common/dto/credencial-garzon.dto';

export class CreateCuentaDto extends CredencialGarzonDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}
