import { SetMetadata } from '@nestjs/common';

export const REQUIRES_PERMISO_KEY = 'requires_permiso';

export const RequiresPermiso = (modulo: string, permiso: string) =>
  SetMetadata(REQUIRES_PERMISO_KEY, { modulo, permiso });
