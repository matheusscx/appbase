import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTenantPasarelaDto } from './create-tenant-pasarela.dto';

export class UpdateTenantPasarelaDto extends PartialType(
  OmitType(CreateTenantPasarelaDto, ['pasarelaId'] as const),
) {}
