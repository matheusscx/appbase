import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PasarelaOrden } from '../pasarela/entities/pasarela-orden.entity';
import {
  PagoCallbackHandler,
  PagoCallbackRegistry,
} from '../pasarela/services/pago-callback.registry';
import { VentasService } from '../ventas/ventas.service';
import type { CreateVentaDto } from '../ventas/dto/create-venta.dto';
import type { CheckoutSnapshot } from './online.service';

/**
 * Callback in-process de la tienda online: cuando una orden de pasarela vuelve
 * `pagada`, crea la venta `canal:'online'` desde el snapshot del carrito y deja
 * `referenciaExterna = venta.id`. Idempotente: si ya hay venta, no hace nada.
 *
 * Se registra en el PagoCallbackRegistry al arrancar, evitando que la pasarela
 * dependa de `online`/`ventas` (el borde se cruza sólo en esta dirección).
 */
@Injectable()
export class OnlineCallbackHandler
  implements PagoCallbackHandler, OnModuleInit
{
  private readonly logger = new Logger(OnlineCallbackHandler.name);

  constructor(
    private readonly registry: PagoCallbackRegistry,
    private readonly ventasService: VentasService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onOrdenResuelta(orden: PasarelaOrden): Promise<void> {
    // Ignorar órdenes de otras apps que compartan la misma pasarela.
    if (orden.metadata?.origenApp !== 'tienda-online') return;
    // Idempotencia: la venta ya fue creada por un retorno previo.
    if (orden.referenciaExterna) return;
    if (orden.estado !== 'pagada') return;

    const snapshot = orden.metadata as unknown as CheckoutSnapshot;
    const checkout = snapshot.checkout;
    if (!checkout) {
      this.logger.error(`Orden ${orden.ordenId} sin snapshot de checkout`);
      return;
    }

    const dto: CreateVentaDto = {
      canal: 'online',
      lineas: checkout.lineas.map((l) => ({
        itemId: l.itemId,
        cantidad: l.cantidad,
      })),
      pagos: [
        { metodoPagoId: checkout.metodoPagoId, monto: checkout.totalFinal },
      ],
      customer: { nombre: checkout.customerNombre },
    };

    const venta = await this.ventasService.crear(
      orden.tenantId,
      checkout.usuarioId,
      dto,
    );
    // El dispatcher persiste la orden (referenciaExterna + estado conciliada).
    orden.referenciaExterna = venta.id;
  }
}
