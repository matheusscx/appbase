import { IsIn } from 'class-validator';
import type { EstadoLinea } from '../paqueteria.types';

export class MarcarLineaDto {
  // en_ruta = deshacer un marcado por error, mientras la hoja está abierta
  @IsIn(['en_ruta', 'entregado', 'no_entregado'])
  estado: EstadoLinea;
}
