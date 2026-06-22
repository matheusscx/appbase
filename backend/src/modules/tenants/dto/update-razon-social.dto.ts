import { PartialType } from '@nestjs/mapped-types';
import { CreateRazonSocialDto } from './create-razon-social.dto';

export class UpdateRazonSocialDto extends PartialType(CreateRazonSocialDto) {}
