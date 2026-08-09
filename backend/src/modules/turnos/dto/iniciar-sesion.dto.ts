import { IsUUID } from 'class-validator';
import { CredencialGarzonOpcionalDto } from '../../../common/dto/credencial-garzon.dto';

export class IniciarSesionDto extends CredencialGarzonOpcionalDto {
  @IsUUID()
  turnoId: string;
}
