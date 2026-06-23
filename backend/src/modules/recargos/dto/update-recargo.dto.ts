import { PartialType } from '@nestjs/mapped-types';
import { CreateRecargoDto } from './create-recargo.dto';

export class UpdateRecargoDto extends PartialType(CreateRecargoDto) {}
