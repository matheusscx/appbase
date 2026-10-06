import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class SetPermissionsDto {
  // Array vacío es válido: reemplaza el conjunto completo de permisos del
  // (rol, módulo) — igual que `SetCajonUsuariosDto` — y vacío desvincula el
  // rol del módulo a propósito (ver `setPermissions` en roles.service.ts).
  @IsArray()
  // Permisos de UN módulo (hoy el que más tiene llega a 7); 100 deja margen
  // para que un módulo crezca sin tocar esto.
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  moduloAppPermisoIds: string[];
}
