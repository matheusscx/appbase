import { IsOptional, IsString } from 'class-validator';
import { CredencialGarzonOpcionalDto } from '../../../common/dto/credencial-garzon.dto';

export class CreateCuentaDto extends CredencialGarzonOpcionalDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}
