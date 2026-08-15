import { IsArray, IsUUID } from 'class-validator';

export class SetPermissionsDto {
  // Array vacío es válido: reemplaza el conjunto completo de permisos del
  // (rol, módulo) — igual que `SetCajonUsuariosDto` — y vacío desvincula el
  // rol del módulo a propósito (ver `setPermissions` en roles.service.ts).
  @IsArray()
  @IsUUID('4', { each: true })
  moduloAppPermisoIds: string[];
}
