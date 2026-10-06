import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class SetCajonUsuariosDto {
  // Array vacío es válido: deja el cajón sin asignados (permisivo).
  @IsArray()
  // Usuarios del tenant asignados a un cajón; el service los resuelve en lote.
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  usuarioIds: string[];
}
