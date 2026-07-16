import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type {
  CalcularVentaDto,
  LineaDto,
} from '../calculo-precios/dto/calcular.dto';
import type { ResultadoVenta } from '../calculo-precios/calculo-precios.engine';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { PagosRedirectService } from '../pasarela/services/pagos-redirect.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
  type UnidadCat,
} from '../../common/utils/cantidad-presentacion.util';

export interface CheckoutLineaSnapshot {
  itemId: string;
  cantidad: string;
  cantidadPresentacion?: string;
  unidadCodigoPresentacion?: string;
}

export interface CheckoutResponse {
  resultado: ResultadoVenta;
  checkoutRef: string;
  checkoutUrl: string;
}

/** Snapshot del carrito que viaja en la orden de pasarela y materializa la venta. */
export interface CheckoutSnapshot {
  origenApp: 'tienda-online';
  checkout: {
    // Solo itemId + cantidad (NO precioUnitario): VentasService reconvierte desde
    // la moneda del ítem, así que fijar el precio ya convertido lo re-convertiría
    // (doble conversión en ítems no-oficiales). El monto cobrado se preserva en
    // totalFinal y se registra como el pago.
    lineas: CheckoutLineaSnapshot[];
    // Ambos métodos se resuelven server-side; el callback elige según el
    // payment_type_code real de Transbank (VD → débito, resto → crédito).
    metodoCreditoId: string;
    metodoDebitoId: string | null;
    totalFinal: string;
    usuarioId: string;
    customerNombre: string;
  };
}

/** Pago simulado (fallback) o real por Webpay, según config del tenant. */
export type PagarResponse =
  | ({ modo: 'simulado' } & CheckoutResponse)
  | { modo: 'webpay'; urlWebpay: string; ordenId: string };

const PASARELA_REDIRECT = 'webpay_plus';

/**
 * Checkout de la tienda online. Si el tenant tiene Webpay Plus activo, `pagar`
 * inicia una orden de pasarela real (redirect) y la venta se crea recién cuando
 * la orden vuelve aprobada (callback in-process, ver OnlineCallbackHandler). Si
 * no, cae al flujo simulado: `checkout` solo calcula y devuelve una URL dummy.
 */
@Injectable()
export class OnlineService {
  constructor(
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly metodosPagoService: MetodosPagoService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly pagosRedirect: PagosRedirectService,
    private readonly config: ConfigService,
    private readonly itemsService: ItemsService,
    private readonly catalogService: CatalogService,
  ) {}

  async checkout(
    tenantId: string,
    dto: CalcularVentaDto,
  ): Promise<CheckoutResponse> {
    const { calcularDto } = await this.prepararLineasCheckout(tenantId, dto);
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
    );
    const checkoutRef = randomUUID();

    return {
      resultado,
      checkoutRef,
      checkoutUrl: `/tienda/pasarela?ref=${checkoutRef}`,
    };
  }

  async pagar(
    tenantId: string,
    usuarioId: string,
    usuarioNombre: string,
    dto: CalcularVentaDto,
  ): Promise<PagarResponse> {
    // Fallback: sin Webpay Plus activo, mantener la pasarela simulada actual.
    const tieneWebpay = await this.webpayActivo(tenantId);
    if (!tieneWebpay) {
      return {
        modo: 'simulado',
        ...(await this.checkout(tenantId, dto)),
      };
    }

    const { calcularDto, lineasSnapshot } = await this.prepararLineasCheckout(
      tenantId,
      dto,
    );
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
    );
    const totalFinal = resultado.totales.totalFinal;
    const { metodoCreditoId, metodoDebitoId } =
      await this.resolverMetodosTarjeta(tenantId);

    const snapshot: CheckoutSnapshot = {
      origenApp: 'tienda-online',
      checkout: {
        lineas: lineasSnapshot,
        metodoCreditoId,
        metodoDebitoId,
        totalFinal,
        usuarioId,
        customerNombre: usuarioNombre || 'Cliente online',
      },
    };

    const retornoUrl = `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'}/tienda/retorno`;
    const { ordenId, urlWebpay } = await this.pagosRedirect.iniciar(
      tenantId,
      {
        monto: totalFinal,
        descripcion: 'Compra Tienda Online',
        urlExito: retornoUrl,
        urlFracaso: retornoUrl,
        urlPendiente: retornoUrl,
      },
      {
        origen: 'interno',
        metadataExtra: snapshot as unknown as Record<string, unknown>,
      },
    );

    return { modo: 'webpay', urlWebpay, ordenId };
  }

  async resultadoOrden(tenantId: string, ordenId: string) {
    const r = await this.pagosRedirect.obtenerResultado(tenantId, ordenId);
    return {
      estado: r.estado,
      ventaId: r.ventaId,
      tipoPago: r.tipoPago,
      numeroCuotas: r.numeroCuotas,
      tarjetaUltimos4: r.tarjetaUltimos4,
      motivoRechazo: r.motivoRechazo,
    };
  }

  private async webpayActivo(tenantId: string): Promise<boolean> {
    try {
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_REDIRECT,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resuelve server-side los métodos de tarjeta habilitados del tenant. El de
   * crédito es obligatorio (fallback: primer habilitado); el de débito es opcional
   * y solo se usa si Transbank confirma un pago RedCompra (payment_type_code VD).
   */
  private async resolverMetodosTarjeta(
    tenantId: string,
  ): Promise<{ metodoCreditoId: string; metodoDebitoId: string | null }> {
    const metodoCreditoId =
      await this.metodosPagoService.resolverMetodoCredito(tenantId);
    const habilitados = (
      await this.metodosPagoService.findMetodosPago(tenantId)
    ).filter((m) => m.habilitada);
    const debito =
      habilitados.find((m) =>
        ['débito', 'debito'].some((t) => m.nombre.toLowerCase().includes(t)),
      ) ?? null;

    return {
      metodoCreditoId,
      metodoDebitoId: debito?.metodoPagoId ?? null,
    };
  }

  private async prepararLineasCheckout(
    tenantId: string,
    dto: CalcularVentaDto,
  ): Promise<{
    calcularDto: CalcularVentaDto;
    lineasSnapshot: CheckoutLineaSnapshot[];
  }> {
    const unidades = await this.catalogService.findAllUnidadesMedida();
    const catalogo: UnidadCat[] = unidades.map((u) => ({
      codigo: u.codigo,
      magnitud: u.magnitud,
      factorBase: u.factorBase,
    }));

    const lineasSnapshot: CheckoutLineaSnapshot[] = [];
    const calcularLineas: LineaDto[] = [];

    for (const linea of dto.lineas) {
      assertPresentacionPareada(
        linea.cantidadPresentacion,
        linea.unidadCodigoPresentacion,
      );
      const item = await this.itemsService.findOne(tenantId, linea.itemId);
      const unidadBase =
        item.tipo === 'receta' ? 'unidad' : (item.unidadMedida ?? 'unidad');

      let cantidadCanonica = linea.cantidad;
      let cantidadPresentacion: string | undefined;
      let unidadCodigoPresentacion: string | undefined;

      if (linea.cantidadPresentacion && linea.unidadCodigoPresentacion) {
        const res = resolverCantidadDesdePresentacion({
          cantidadPresentacion: linea.cantidadPresentacion,
          unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
          unidadBaseCodigo: unidadBase,
          catalogo,
          forzarConteo: item.tipo === 'receta',
        });
        cantidadCanonica = res.cantidadCanonica;
        cantidadPresentacion = res.cantidadPresentacion;
        unidadCodigoPresentacion = res.unidadCodigoPresentacion;
      }

      calcularLineas.push({
        ...linea,
        cantidad: cantidadCanonica,
      });
      lineasSnapshot.push({
        itemId: linea.itemId,
        cantidad: cantidadCanonica,
        ...(cantidadPresentacion && unidadCodigoPresentacion
          ? { cantidadPresentacion, unidadCodigoPresentacion }
          : {}),
      });
    }

    return {
      calcularDto: { ...dto, lineas: calcularLineas },
      lineasSnapshot,
    };
  }
}
