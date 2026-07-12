import { IsIn, IsOptional } from 'class-validator';

export class IniciarMedioPagoDto {
  // Página de la tienda a la que volver tras inscribir la tarjeta. Se whitelistea
  // server-side; default "medios-pago". "suscripciones" reanuda el alta pendiente.
  @IsOptional()
  @IsIn(['medios-pago', 'suscripciones'])
  retornoPath?: 'medios-pago' | 'suscripciones';
}
