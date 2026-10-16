import { IsIn, ValidateIf } from 'class-validator';
import type { EstadoLinea, MedioCobro } from '../paqueteria.types';

export class MarcarLineaDto {
  // en_ruta = deshacer un marcado por error, mientras la hoja está abierta
  @IsIn(['en_ruta', 'entregado', 'no_entregado'])
  estado: EstadoLinea;

  /**
   * Cómo se pagó el cobro en destino. Solo con `entregado` y un paquete con cobro en destino
   * (lo valida el service: el cobro vive en `paquetes`); ausente = efectivo, o el que ya tenía.
   */
  // `null` es 400, no "ausente": solo `undefined` salta la validación.
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['efectivo', 'transferencia'])
  medioCobro?: MedioCobro;
}
