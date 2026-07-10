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
 * `ventaId = venta.id`. Idempotente: si ya hay venta, no hace nada.
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
    if (orden.ventaId) return;
    if (orden.estado !== 'pagada') return;

    const snapshot = orden.metadata as unknown as CheckoutSnapshot;
    const checkout = snapshot.checkout;
    if (!checkout) {
      this.logger.error(`Orden ${orden.ordenId} sin snapshot de checkout`);
      return;
    }

    // Detalle real del pago (lo escribió PagosRedirectService al confirmar).
    const resultadoPago = (orden.metadata?.resultadoPago ?? {}) as {
      tipoPago?: string | null;
      numeroCuotas?: number | null;
      tarjetaUltimos4?: string | null;
    };

    // Débito RedCompra (payment_type_code VD) → método débito si el tenant lo
    // tiene habilitado; cualquier otro tipo (o sin débito configurado) → crédito.
    const esDebito =
      resultadoPago.tipoPago === 'VD' && checkout.metodoDebitoId != null;
    const metodoPagoId = esDebito
      ? (checkout.metodoDebitoId as string)
      : checkout.metodoCreditoId;

    const dto: CreateVentaDto = {
      canal: 'online',
      lineas: checkout.lineas.map((l) => ({
        itemId: l.itemId,
        cantidad: l.cantidad,
      })),
      pagos: [
        {
          metodoPagoId,
          monto: checkout.totalFinal,
          numeroCuotas: resultadoPago.numeroCuotas ?? undefined,
          tipoPago: resultadoPago.tipoPago ?? undefined,
          tarjetaUltimos4: resultadoPago.tarjetaUltimos4 ?? undefined,
        },
      ],
      customer: { nombre: checkout.customerNombre },
    };

    const venta = await this.ventasService.crear(
      orden.tenantId,
      checkout.usuarioId,
      dto,
    );
    // El dispatcher persiste la orden (ventaId + estado conciliada).
    orden.ventaId = venta.id;
  }
}
