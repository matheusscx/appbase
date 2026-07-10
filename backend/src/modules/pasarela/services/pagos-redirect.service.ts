import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { CreatePagoDto } from '../dto/create-pago.dto';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CallbackDispatcherService } from './callback-dispatcher.service';
import { ProviderFactory } from '../providers/provider.factory';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';
import { descripcionCodigoRespuesta } from '../utils/codigos-respuesta';

/** Detalle del pago que el commit devuelve y el callback / la app consumen. */
interface ResultadoPagoMeta {
  tipoPago: string | null;
  numeroCuotas: number | null;
  tarjetaUltimos4: string | null;
  codigoRespuesta: string | null;
  codigoAutorizacion: string | null;
}

const PASARELA_REDIRECT = 'webpay_plus'; // v1 redirect: única pasarela redirect
const EXPIRACION_ORDEN_MS = 2 * 60 * 60 * 1000; // 2 horas

/** Opciones de origen para iniciar un pago (m2m vs in-process del monolito). */
export interface IniciarPagoOpts {
  origen?: 'api' | 'interno';
  apiKeyId?: string;
  /** Se fusiona en metadata: snapshot que el callback necesita (p. ej. el carrito). */
  metadataExtra?: Record<string, unknown>;
}

/**
 * Flujo de pago único con redirect (Webpay Plus): crea la orden y la transacción
 * en el proveedor (iniciar), el comprador paga en el formulario hosted, y el
 * retorno público confirma (commit). Respeta el invariante de timeout: un error
 * de red en el commit deja la orden `en_proceso`, nunca `fallida`.
 *
 * Al resolver dispara un callback (in-process para el monolito, POST para apps
 * externas) que materializa el lado de la app; ver CallbackDispatcherService.
 */
@Injectable()
export class PagosRedirectService {
  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly callbackDispatcher: CallbackDispatcherService,
    private readonly providerFactory: ProviderFactory,
    private readonly config: ConfigService,
  ) {}

  /** buyOrder ≤26 chars (límite Webpay): 'W' + timestamp36 + 8 random. */
  private generarCodigoOrden(): string {
    return `W${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  /** URL de retorno al navegador según el estado resuelto de la orden. */
  private urlRetornoApp(orden: PasarelaOrden): string {
    const urls = (orden.metadata?.urls ?? {}) as Record<string, string>;
    // conciliada = pagada + materializada; de cara al usuario es un éxito.
    const estado = orden.estado === 'conciliada' ? 'pagada' : orden.estado;
    let base: string;
    if (estado === 'pagada') base = urls.exito ?? '';
    else if (estado === 'pendiente') base = urls.pendiente ?? urls.exito ?? '';
    else base = urls.fracaso ?? '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}ordenId=${orden.ordenId}&estado=${estado}`;
  }

  async iniciar(
    tenantId: string,
    dto: CreatePagoDto,
    opts: IniciarPagoOpts = {},
  ) {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    const origen = opts.origen ?? 'api';

    const { tenantPasarela, pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_REDIRECT,
      );

    const codigoOrden = this.generarCodigoOrden();
    const returnUrl = `${this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000'}/api/pasarela/retorno/pago`;

    const provider = this.providerFactory.getPagoRedirect(pasarela.codigo);
    const inicio = await provider.iniciarPago(cred, {
      codigoOrden,
      monto: dto.monto,
      moneda: 'CLP',
      returnUrl,
    });

    const orden = await this.ordenRepo.save(
      this.ordenRepo.create({
        tenantId,
        pagadorRef: dto.pagadorRef ?? null,
        referenciaExterna: dto.referenciaExterna ?? null,
        codigoOrden,
        descripcion: dto.descripcion,
        monto: dto.monto,
        moneda: 'CLP',
        estado: 'en_proceso',
        fechaExpiracion: new Date(Date.now() + EXPIRACION_ORDEN_MS),
        tokenProveedor: inicio.tokenExterno,
        origen,
        apiKeyId: opts.apiKeyId ?? null,
        metadata: {
          ...(opts.metadataExtra ?? {}),
          urls: {
            exito: dto.urlExito,
            fracaso: dto.urlFracaso,
            pendiente: dto.urlPendiente ?? dto.urlExito,
            callback: dto.urlCallback ?? null,
          },
          // El monolito resuelve el callback en proceso; las apps externas por HTTP.
          callbackModo: origen === 'interno' ? 'interno' : 'http',
          // tenantPasarelaId queda para registrar la transacción en el retorno.
          tenantPasarelaId: tenantPasarela.tenantPasarelaId,
        },
      }),
    );

    return {
      ordenId: orden.ordenId,
      urlWebpay: inicio.urlRedireccion,
      token: inicio.tokenExterno,
    };
  }

  /** Retorno de Webpay: confirma el pago contra el proveedor y redirige a la app. */
  async confirmarRetorno(token: string): Promise<{ urlRedireccion: string }> {
    // Claim atómico: solo una request pasa 'en_proceso' → 'procesando'. Cierra la
    // ventana de doble retorno de Webpay (reintento) que duplicaría el commit.
    const claim = await this.ordenRepo.update(
      { tokenProveedor: token, estado: 'en_proceso' },
      { estado: 'procesando' },
    );
    const orden = await this.ordenRepo.findOne({
      where: { tokenProveedor: token },
    });
    if (!orden)
      throw new NotFoundException('Orden no encontrada para el token');
    // Otra request ya la reclamó/resolvió: redirige con el estado actual (idempotente).
    if (!claim.affected) return { urlRedireccion: this.urlRetornoApp(orden) };

    const tenantPasarelaId =
      typeof orden.metadata?.tenantPasarelaId === 'string'
        ? orden.metadata.tenantPasarelaId
        : undefined;

    try {
      const { pasarela, cred } =
        await this.tenantPasarelaService.resolverConfiguracionActiva(
          orden.tenantId,
          PASARELA_REDIRECT,
        );
      const resultado = await this.providerFactory
        .getPagoRedirect(pasarela.codigo)
        .confirmarPago(cred, token);

      await this.transacciones.registrar({
        tenantId: orden.tenantId,
        ordenId: orden.ordenId,
        tenantPasarelaId,
        tipo: 'AUTHORIZATION',
        estado: resultado.aprobada ? 'aprobada' : 'rechazada',
        monto: orden.monto,
        moneda: orden.moneda,
        codigoOrden: orden.codigoOrden,
        codigoAutorizacion: resultado.codigoAutorizacion,
        identificadorTransaccionExterno:
          resultado.identificadorTransaccionExterno,
        codigoRespuesta: resultado.codigoRespuesta,
        tipoPago: resultado.tipoPago,
        request: resultado.request,
        response: resultado.response,
      });

      // Propaga el detalle del commit a la orden: el callback lo usa para elegir
      // el método real (débito/crédito) y persistir cuotas / últimos4; en rechazo,
      // el codigoRespuesta permite traducir el motivo nivel 2 en la página de retorno.
      const resultadoPago: ResultadoPagoMeta = {
        tipoPago: resultado.tipoPago,
        numeroCuotas: resultado.numeroCuotas,
        tarjetaUltimos4: resultado.tarjetaUltimos4,
        codigoRespuesta: resultado.codigoRespuesta,
        codigoAutorizacion: resultado.codigoAutorizacion,
      };
      orden.metadata = { ...orden.metadata, resultadoPago };
      orden.estado = resultado.aprobada ? 'pagada' : 'fallida';
      await this.ordenRepo.save(orden);
    } catch (e) {
      // Compensación: devolver 'procesando' → 'en_proceso' para no dejarla trabada
      // y que un reintento del retorno / verificación pueda reprocesarla.
      await this.ordenRepo.update(
        { ordenId: orden.ordenId, estado: 'procesando' },
        { estado: 'en_proceso' },
      );
      if (e instanceof ProviderComunicacionError) {
        // Mismo invariante que cobrar(): un timeout NO es rechazo. Dejar rastro y
        // responder consistente (BadGateway); la orden queda en_proceso.
        await this.transacciones.registrar({
          tenantId: orden.tenantId,
          ordenId: orden.ordenId,
          tenantPasarelaId,
          tipo: 'AUTHORIZATION',
          estado: 'error',
          monto: orden.monto,
          moneda: orden.moneda,
          codigoOrden: orden.codigoOrden,
          request: e.request,
          response: e.response,
        });
        throw new BadGatewayException(
          `No se pudo confirmar el pago (orden ${orden.ordenId}); verifique el estado con POST /pasarela/api/ordenes/${orden.ordenId}/verificar`,
        );
      }
      throw e;
    }

    // Dispara el callback (materializa la venta en el monolito y concilia la
    // orden). No rompe el redirect si falla; ver CallbackDispatcherService.
    await this.callbackDispatcher.dispatch(orden);

    return { urlRedireccion: this.urlRetornoApp(orden) };
  }

  /**
   * Retorno de anulación/timeout de Webpay: el usuario abortó en el formulario o
   * expiró la sesión, por lo que Transbank vuelve con `TBK_TOKEN`/`TBK_ORDEN_COMPRA`
   * y SIN `token_ws` (nunca se autorizó). Marca la orden `fallida` si sigue abierta
   * y redirige a la URL de fracaso de la app. Idempotente: no pisa un estado
   * terminal (por un doble-retorno).
   */
  async abortarRetorno(p: {
    tbkToken?: string;
    ordenCompra?: string;
  }): Promise<{ urlRedireccion: string }> {
    if (!p.ordenCompra && !p.tbkToken)
      throw new BadRequestException('Retorno de anulación sin identificador');
    const orden = await this.ordenRepo.findOne({
      where: p.ordenCompra
        ? { codigoOrden: p.ordenCompra }
        : { tokenProveedor: p.tbkToken },
    });
    if (!orden)
      throw new NotFoundException('Orden no encontrada para el retorno');

    if (['creada', 'en_proceso', 'procesando'].includes(orden.estado)) {
      orden.estado = 'fallida';
      orden.metadata = {
        ...orden.metadata,
        aborto: {
          tbkToken: p.tbkToken ?? null,
          en: new Date().toISOString(),
        },
      };
      await this.ordenRepo.save(orden);
    }
    return { urlRedireccion: this.urlRetornoApp(orden) };
  }

  /** Resultado de una orden para la página de retorno de la app (scoped a tenant). */
  async obtenerResultado(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    const rp = (orden.metadata?.resultadoPago ??
      {}) as Partial<ResultadoPagoMeta>;
    return {
      ordenId: orden.ordenId,
      estado: orden.estado,
      ventaId: orden.ventaId,
      // Comprobante (éxito) y motivo de rechazo (nivel 2) para la página de retorno.
      tipoPago: rp.tipoPago ?? null,
      numeroCuotas: rp.numeroCuotas ?? null,
      tarjetaUltimos4: rp.tarjetaUltimos4 ?? null,
      motivoRechazo:
        orden.estado === 'fallida'
          ? descripcionCodigoRespuesta(rp.codigoRespuesta)
          : null,
    };
  }
}
