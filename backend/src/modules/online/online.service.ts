import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
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
  resolverUnidadBaseDeItem,
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

/** Pago simulado (pasarela demo) o real por Webpay, según config del tenant. */
export type PagarResponse =
  | ({ modo: 'simulado'; metodoPagoId: string | null } & CheckoutResponse)
  | { modo: 'webpay'; urlWebpay: string; ordenId: string };

const PASARELA_REDIRECT = 'webpay_plus';
const PASARELA_DEMO = 'demo';

/**
 * Checkout de la tienda online. Si el tenant tiene Webpay Plus activo, `pagar`
 * inicia una orden de pasarela real (redirect) y la venta se crea recién cuando
 * la orden vuelve aprobada (callback in-process, ver OnlineCallbackHandler). Si
 * no, y el tenant tiene prendida la **pasarela demo**, cae al flujo simulado:
 * `checkout` solo calcula y devuelve una URL dummy, y la pantalla registra la
 * venta como pagada sin que nadie cobre. Sin ninguna de las dos configuradas la
 * tienda **no cierra el pedido**: antes el simulado era lo que sobraba cuando
 * faltaba Webpay, y cualquier tenant lo heredaba sin haberlo elegido.
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
    // Precedencia: la que cobra de verdad le gana a la que simula. Con las dos
    // prendidas, apagar Webpay en Configuración → Pasarelas es lo que hace caer
    // la tienda a la demo — y esa es toda la puerta a la pantalla simulada.
    const tieneWebpay = await this.webpayActivo(tenantId);
    if (!tieneWebpay) {
      // La demo se PRENDE, no se hereda: sin ninguna pasarela configurada la
      // tienda no cierra el pedido, en vez de entregar y anotarlo cobrado.
      if (
        !(await this.tenantPasarelaService.codigoActivo(
          tenantId,
          PASARELA_DEMO,
        ))
      )
        throw new BadRequestException(
          'Este local todavía no tiene un medio de cobro online configurado',
        );
      const checkout = await this.checkout(tenantId, dto);
      // El método lo resuelve el backend, igual que la rama Webpay: la pantalla
      // lo elegía sola por el nombre y caía en `metodos[0]`, sin mirar siquiera
      // si estaba habilitado. Un carrito de $0 no registra pago, así que ahí no
      // se resuelve nada — resolverlo abortaría con 400 un checkout que hoy
      // funciona en un tenant sin métodos habilitados.
      const sinCobro = new Decimal(checkout.resultado.totales.totalFinal).lte(
        0,
      );
      return {
        modo: 'simulado',
        metodoPagoId: sinCobro
          ? null
          : await this.metodosPagoService.resolverMetodoCredito(tenantId),
        ...checkout,
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

    // El pareado se valida ANTES de cargar, para que su 400 no pierda contra el
    // 404 de un ítem inexistente. Ojo: es la única de las dos validaciones por
    // línea que se puede adelantar — `resolverCantidadDesdePresentacion`
    // necesita la `unidadBase` del ítem, así que su 400 sigue perdiendo contra
    // el 404 cuando el carrito trae los dos errores a la vez.
    for (const linea of dto.lineas) {
      assertPresentacionPareada(
        linea.cantidadPresentacion,
        linea.unidadCodigoPresentacion,
      );
    }

    // Una carga para todo el carrito: acá solo se usan `tipo` y `unidadMedida`
    // del row base. `findOne` por línea traía además impuestos, descuentos,
    // recargos, ingredientes, componentes y grupos, todos descartados.
    // `cargarBasePorIds` lanza el mismo 404 si un id no existe o no es del tenant.
    const itemsBase = await this.itemsService.cargarBasePorIds(
      tenantId,
      dto.lineas.map((l) => l.itemId),
    );

    // Un ítem pausado NO se vende online: acá todavía no pasó nada —el cliente
    // no recibió el producto— y cobrar algo que se sacó de venta es la peor
    // salida. El POS, en cambio, solo advierte (`CalculoPreciosService`): en el
    // mostrador el producto puede estar ya en la mano del cliente.
    //
    // El carrito online vive en el navegador (no hay tabla `carrito`), así que
    // el ítem se puede pausar entre que el cliente lo agrega y que paga: el
    // checkout es el único punto donde atajarlo. El mensaje nombra el producto
    // porque un carrito de ocho líneas con un "no disponible" genérico deja al
    // cliente adivinando cuál sacar.
    //
    // Se corta ANTES de `pagosRedirect.iniciar`, así que no queda orden creada.
    for (const linea of dto.lineas) {
      const item = itemsBase.get(linea.itemId)!;
      if (!item.activo) {
        throw new BadRequestException(
          `El producto "${item.nombre}" ya no se encuentra disponible`,
        );
      }
    }

    for (const linea of dto.lineas) {
      const item = itemsBase.get(linea.itemId)!;
      const { unidadBaseCodigo, forzarConteo } = resolverUnidadBaseDeItem(item);

      let cantidadCanonica = linea.cantidad;
      let cantidadPresentacion: string | undefined;
      let unidadCodigoPresentacion: string | undefined;

      if (linea.cantidadPresentacion && linea.unidadCodigoPresentacion) {
        const res = resolverCantidadDesdePresentacion({
          cantidadPresentacion: linea.cantidadPresentacion,
          unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
          unidadBaseCodigo,
          catalogo,
          forzarConteo,
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
      // `cuentaId` NUNCA se reenvía tal cual llegó del cliente: `CalcularVentaDto`
      // lo declara opcional para la previsualización de salón (que no cobra), y
      // `whitelist: true` lo deja pasar el pipe igual en este DTO. Pero este
      // camino sí cobra — `pagar()` autoriza `resultado.totales.totalFinal`
      // contra la tarjeta con el resultado de este mismo `calcularDto` — así que
      // un `cuentaId` de una cuenta abierta dentro de una promo vieja movería la
      // vigencia y descuadraría el cargo contra lo que la venta persiste después
      // (el callback recalcula sin `cuentaId`, o sea con "ahora"). La tienda
      // online no tiene noción de cuenta de salón: el instante siempre es ahora.
      calcularDto: { ...dto, cuentaId: undefined, lineas: calcularLineas },
      lineasSnapshot,
    };
  }
}
