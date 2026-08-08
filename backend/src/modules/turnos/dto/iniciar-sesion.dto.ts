import { IsUUID } from 'class-validator';
import { CredencialGarzonDto } from '../../../common/dto/credencial-garzon.dto';

export class IniciarSesionDto extends CredencialGarzonDto {
  @IsUUID()
  turnoId: string;
}
