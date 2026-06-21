import { IsUUID } from 'class-validator';

export class AssignUserDto {
  @IsUUID()
  usuarioId: string;
}
