import { IsIn } from 'class-validator';
import type { RolImpresora } from '../entities/impresora.entity';

/**
 * `rol` acá es **obligatorio** (a diferencia de `QueryImpresorasDto`, donde es
 * un filtro opcional del listado de configuración): quien imprime siempre
 * sabe qué está por imprimir —comanda o boleta/precuenta—, así que no hay un
 * caso de uso para "todas las impresoras operativas, sin distinguir rol".
 */
export class QueryImpresorasOperacionDto {
  @IsIn(['comanda', 'boleta'])
  rol: RolImpresora;
}
