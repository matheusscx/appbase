import { IsArray, IsUUID } from 'class-validator';

export class SetCajonUsuariosDto {
  // Array vacío es válido: deja el cajón sin asignados (permisivo).
  @IsArray()
  @IsUUID('4', { each: true })
  usuarioIds: string[];
}
