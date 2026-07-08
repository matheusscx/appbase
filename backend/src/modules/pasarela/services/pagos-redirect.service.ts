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
import { ProviderFactory } from '../providers/provider.factory';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';

const PASARELA_REDIRECT = 'webpay_plus'; // v1 redirect: única pasarela redirect
const EXPIRACION_ORDEN_MS = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Flujo de pago único con redirect (Webpay Plus): crea la orden y la transacción
 * en el proveedor (iniciar), el comprador paga en el formulario hosted, y el
 * retorno público confirma (commit). Respeta el invariante de timeout: un error
 * de red en el commit deja la orden `en_proceso`, nunca `fallida`.
 */
@Injectable()
export class PagosRedirectService {
  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly providerFactory: ProviderFactory,
    private readonly config: ConfigService,
  ) {}

  /** buyOrder ≤26 chars (límite Webpay): 'W' + timestamp36 + 8 random. */
  private generarCodigoOrden(): string {
    return `W${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  private urlRetornoApp(orden: PasarelaOrden): string {
    const url =
      typeof orden.metadata?.urlRetornoApp === 'string'
        ? orden.metadata.urlRetornoApp
        : '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}ordenId=${orden.ordenId}&estado=${orden.estado}`;
  }

  async iniciar(tenantId: string, dto: CreatePagoDto) {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

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
        origen: 'api',
        metadata: { urlRetornoApp: dto.urlRetorno },
      }),
    );

    // tenantPasarelaId queda en metadata para el registro de la transacción en el retorno.
    orden.metadata = {
      ...orden.metadata,
      tenantPasarelaId: tenantPasarela.tenantPasarelaId,
    };
    await this.ordenRepo.save(orden);

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

    return { urlRedireccion: this.urlRetornoApp(orden) };
  }
}
