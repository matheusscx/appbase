import { IsUUID } from 'class-validator';

export class AddModuleDto {
  @IsUUID()
  moduloAppId: string;
}
