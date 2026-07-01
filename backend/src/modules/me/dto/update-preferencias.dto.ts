import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, ValidateNested } from 'class-validator';
import {
  ALLOWED_PAGE_SIZES,
  type ColorModePreference,
} from '../../../common/types/usuario-preferencias.interface';

class UiPreferenciasDto {
  @IsOptional()
  @IsIn(['system', 'light', 'dark'])
  colorMode?: ColorModePreference;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ALLOWED_PAGE_SIZES)
  pageSize?: (typeof ALLOWED_PAGE_SIZES)[number];
}

export class UpdatePreferenciasDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UiPreferenciasDto)
  ui?: UiPreferenciasDto;
}
