import { IsIn, IsOptional } from 'class-validator';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';
import type { RolImpresora } from '../entities/impresora.entity';

// `QueryIncluirEliminadosDto` es compartido por los 16 recursos de la
// papelera: `rol` no le corresponde a él (es propio de este listado), así
// que se extiende acá en vez de agregarlo al DTO común.
export class QueryImpresorasDto extends QueryIncluirEliminadosDto {
  @IsOptional()
  @IsIn(['comanda', 'boleta'])
  rol?: RolImpresora;
}
