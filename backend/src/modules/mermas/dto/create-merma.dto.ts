import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class CreateMermaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsOptional()
  unidadCodigo?: string;

  @IsUUID()
  causaMermaId: string;

  @IsString()
  @IsOptional()
  comentario?: string;

  // Omitirlo = "valorizar con el costo actual del producto"; si viene, es el
  // costo por la unidad ingresada y tiene que ser > 0.
  // Ojo con `mermas.service.ts`: su rama `costoUnitario === ''` trata la cadena
  // vacía como "sin costo", pero `@IsNumberString` la rechaza desde antes de
  // este decorador (`@IsOptional` solo saltea `null`/`undefined`), así que esa
  // rama ya era inalcanzable por HTTP. El signo acá no la revive ni la mata.
  @IsOptional()
  @IsNumberString()
  @IsDecimalPositivo()
  @EsCosto()
  costoUnitario?: string;
}
