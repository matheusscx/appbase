import { IsBoolean } from 'class-validator';

export class SetArqueoCiegoDto {
  @IsBoolean()
  arqueoCiego: boolean;
}
