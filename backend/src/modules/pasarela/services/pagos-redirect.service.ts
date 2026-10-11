import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Db } from '../../../common/db/db.service';
import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import {
  esPagadaSinVenta,
  MONEDA_ORDEN_V1,
  PasarelaOrden,
} from '../entities/pasarela-orden.entity';
import { CreatePagoDto } from '../dto/create-pago.dto';
import { MonedasService } from '../../monedas/monedas.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CallbackDispatcherService } from './callback-dispatcher.service';
import { ProviderFactory } from '../providers/provider.factory';
import {
  DetallePago,
  ProviderComunicacionError,
  ResultadoCobro,
} from '../providers/payment-provider.interface';
import { descripcionCodigoRespuesta } from '../utils/codigos-respuesta';

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
  private readonly logger = new Logger(PagosRedirectService.name);

  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly callbackDispatcher: CallbackDispatcherService,
    private readonly providerFactory: ProviderFactory,
    private readonly config: ConfigService,
    private readonly monedas: MonedasService,
    private readonly db: Db,
  ) {}

  /** buyOrder ≤26 chars (límite Webpay): 'W' + timestamp36 + 8 random. */
  private generarCodigoOrden(): string {
    return `W${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  /**
   * El estado de una orden de cara a la app que la pidió. La pagada sin venta
   * tiene uno propio: con `pagada` el comprador leía "Tu compra fue
   * registrada" sobre una venta que no existe (pendientes.md § 3, D).
   */
  private estadoParaLaApp(orden: PasarelaOrden): string {
    return esPagadaSinVenta(orden) ? 'pagada_sin_venta' : orden.estado;
  }

  /** URL de retorno al navegador según el estado resuelto de la orden. */
  private urlRetornoApp(orden: PasarelaOrden): string {
    const urls = (orden.metadata?.urls ?? {}) as Record<string, string>;
    // conciliada = pagada + materializada; de cara al usuario es un éxito.
    const estado =
      orden.estado === 'conciliada' ? 'pagada' : this.estadoParaLaApp(orden);
    let base: string;
    // Sin venta también vuelve a la URL de éxito: la plata llegó, y la página
    // de retorno distingue el caso por el estado.
    if (estado === 'pagada' || estado === 'pagada_sin_venta')
      base = urls.exito ?? '';
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
    // Mismo borde que `CobrosService.cobrar`: acá el proveedor se llama ANTES
    // de persistir, así que no queda orden huérfana, pero el 400 igual salía de
    // adentro de `montoEntero` en vez de del borde que recibió el monto.
    await this.monedas.validarEscalaDeMoneda(dto.monto, MONEDA_ORDEN_V1);

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
      moneda: MONEDA_ORDEN_V1,
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
        moneda: MONEDA_ORDEN_V1,
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

  /**
   * Retorno de Webpay: confirma el pago contra el proveedor y redirige a la app.
   *
   * El claim (`en_proceso` → `procesando`) commitea solo, antes de llamar a
   * Transbank, y lo único que lo deshace es la compensación del `catch`. Por
   * eso la orden se lee ANTES de reclamarla: leerla después dejaba un error
   * de base fuera del `try`, y la orden `procesando`. La compensación no tapa
   * el error original; si falla, o si el proceso muere en el medio, la orden
   * queda `procesando` y la rescata `verificar` pasada la ventana
   * (`CobrosService.verificar`). Los tres caminos, medidos en
   * `pasarela-escritores-orden.e2e-spec.ts`.
   */
  async confirmarRetorno(token: string): Promise<{ urlRedireccion: string }> {
    const leida = await this.ordenRepo.findOne({
      where: { tokenProveedor: token },
    });
    if (!leida)
      throw new NotFoundException('Orden no encontrada para el token');
    // Claim atómico: solo una request pasa 'en_proceso' → 'procesando'. Cierra la
    // ventana de doble retorno de Webpay (reintento) que duplicaría el commit.
    const claim = await this.ordenRepo.update(
      { ordenId: leida.ordenId, estado: 'en_proceso' },
      { estado: 'procesando' },
    );
    // Otra request ya la reclamó/resolvió: redirige con el estado actual (idempotente).
    if (!claim.affected) {
      const actual = await this.ordenRepo.findOne({
        where: { ordenId: leida.ordenId },
      });
      return { urlRedireccion: this.urlRetornoApp(actual ?? leida) };
    }

    const tenantPasarelaId =
      typeof leida.metadata?.tenantPasarelaId === 'string'
        ? leida.metadata.tenantPasarelaId
        : undefined;
    let orden = leida;
    let resultado: ResultadoCobro | undefined;
    let yaResuelta = false;

    try {
      const { pasarela, cred } =
        await this.tenantPasarelaService.resolverConfiguracionActiva(
          orden.tenantId,
          PASARELA_REDIRECT,
        );
      const confirmado = await this.providerFactory
        .getPagoRedirect(pasarela.codigo)
        .confirmarPago(cred, token);
      resultado = confirmado;

      // El cierre, con la orden bloqueada y solo si sigue sin resolver: un
      // retorno que tardó más que la ventana puede encontrarla rescatada por
      // `verificar`. Si `verificar` la resolvió (y, en la tienda, creó la
      // venta), pisarla duplicaba la AUTHORIZATION y la dejaba `pagada` sobre
      // una `conciliada`. Si Transbank no le supo decir y la devolvió a
      // `en_proceso`, lo que acaba de contestar el commit es la respuesta.
      orden = await this.db.transaccion(async () => {
        const bloqueada = await this.ordenRepo.findOne({
          where: { ordenId: leida.ordenId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!bloqueada)
          throw new NotFoundException('Orden no encontrada para el token');
        if (
          !['procesando', 'en_proceso', 'expirada'].includes(bloqueada.estado)
        ) {
          yaResuelta = true;
          return bloqueada;
        }

        await this.transacciones.registrar({
          tenantId: bloqueada.tenantId,
          ordenId: bloqueada.ordenId,
          tenantPasarelaId,
          tipo: 'AUTHORIZATION',
          estado: confirmado.aprobada ? 'aprobada' : 'rechazada',
          monto: bloqueada.monto,
          moneda: bloqueada.moneda,
          codigoOrden: bloqueada.codigoOrden,
          codigoAutorizacion: confirmado.codigoAutorizacion,
          identificadorTransaccionExterno:
            confirmado.identificadorTransaccionExterno,
          codigoRespuesta: confirmado.codigoRespuesta,
          tipoPago: confirmado.tipoPago,
          request: confirmado.request,
          response: confirmado.response,
        });

        // Propaga el detalle del commit a la orden: el callback lo usa para elegir
        // el método real (débito/crédito) y persistir cuotas / últimos4; en rechazo,
        // el codigoRespuesta permite traducir el motivo nivel 2 en la página de retorno.
        const resultadoPago: DetallePago = {
          tipoPago: confirmado.tipoPago,
          numeroCuotas: confirmado.numeroCuotas,
          tarjetaUltimos4: confirmado.tarjetaUltimos4,
          codigoRespuesta: confirmado.codigoRespuesta,
          codigoAutorizacion: confirmado.codigoAutorizacion,
        };
        bloqueada.metadata = { ...bloqueada.metadata, resultadoPago };
        bloqueada.estado = confirmado.aprobada ? 'pagada' : 'fallida';
        return this.ordenRepo.save(bloqueada);
      });
    } catch (e) {
      // Compensación: devolver 'procesando' → 'en_proceso' para no dejarla trabada
      // y que un reintento del retorno / verificación pueda reprocesarla. No
      // tapa el error original: si falla, la orden queda `procesando` y la
      // rescata `verificar` pasada la ventana.
      await this.ordenRepo
        .update(
          { ordenId: orden.ordenId, estado: 'procesando' },
          { estado: 'en_proceso' },
        )
        .catch((err) =>
          this.logger.warn(
            `No se pudo devolver la orden ${orden.ordenId} a 'en_proceso': queda 'procesando' hasta que la rescate verificar: ${String(err)}`,
          ),
        );
      // Transbank ya contestó y lo que falló fue el cierre: su rollback se
      // llevó la AUTHORIZATION. Sin rastro, el reloj la expiraba como si no
      // hubiera intentado cobrar, y el cargo pudo salir. La `error` la saca de
      // la expiración y la deja para `verificar`, como un timeout.
      if (resultado)
        await this.transacciones
          .registrar({
            tenantId: orden.tenantId,
            ordenId: orden.ordenId,
            tenantPasarelaId,
            tipo: 'AUTHORIZATION',
            estado: 'error',
            monto: orden.monto,
            moneda: orden.moneda,
            codigoOrden: orden.codigoOrden,
            request: resultado.request,
            response: resultado.response,
          })
          .catch((err) =>
            this.logger.warn(
              `No se pudo anotar el commit de la orden ${orden.ordenId}, que Transbank contestó: ${String(err)}`,
            ),
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
    // Si la resolvió `verificar`, no: ella crea la venta de la tienda, y la
    // app por llave es la que la llamó.
    if (!yaResuelta) await this.callbackDispatcher.dispatch(orden);

    return { urlRedireccion: this.urlRetornoApp(orden) };
  }

  /**
   * Retorno de anulación/timeout de Webpay: el usuario abortó en el formulario o
   * expiró la sesión, por lo que Transbank vuelve con `TBK_TOKEN`/`TBK_ORDEN_COMPRA`
   * y SIN `token_ws` (nunca se autorizó). Marca la orden `fallida` si sigue abierta
   * y redirige a la URL de fracaso de la app. Idempotente: no pisa un estado
   * terminal (por un doble-retorno).
   *
   * La orden se lee con `FOR UPDATE`: si `verificar` la tiene bloqueada
   * mientras consulta a Transbank, esto espera y decide por lo que quedó. Sin
   * el lock, el `save` de la entidad entera dejaba `fallida`, y sin la
   * metadata de la verificación, una orden que `verificar` acababa de
   * encontrar pagada (pendientes.md § 5, medido en
   * `pasarela-escritores-orden.e2e-spec.ts`).
   *
   * Una `procesando` no se anula: el retorno ya tiene el `token_ws` y está
   * confirmando, y lo que conteste Transbank decide (un commit sobre una
   * transacción anulada vuelve 4xx y queda `fallida` por ese camino). El
   * retorno no bloquea la orden mientras confirma, así que anularla acá la
   * dejaba `fallida` debajo suyo: si Transbank no contestaba, la compensación
   * ya no la encontraba y un cargo quizá aprobado quedaba `fallida`, donde
   * `verificar` ya no la mira (resueltos.md, medido en el mismo e2e).
   */
  async abortarRetorno(p: {
    tbkToken?: string;
    ordenCompra?: string;
  }): Promise<{ urlRedireccion: string }> {
    if (!p.ordenCompra && !p.tbkToken)
      throw new BadRequestException('Retorno de anulación sin identificador');
    const orden = await this.db.transaccion(async () => {
      const bloqueada = await this.ordenRepo.findOne({
        where: p.ordenCompra
          ? { codigoOrden: p.ordenCompra }
          : { tokenProveedor: p.tbkToken },
        lock: { mode: 'pessimistic_write' },
      });
      if (!bloqueada)
        throw new NotFoundException('Orden no encontrada para el retorno');

      if (['creada', 'en_proceso'].includes(bloqueada.estado)) {
        bloqueada.estado = 'fallida';
        bloqueada.metadata = {
          ...bloqueada.metadata,
          aborto: {
            tbkToken: p.tbkToken ?? null,
            en: new Date().toISOString(),
          },
        };
        await this.ordenRepo.save(bloqueada);
      }
      return bloqueada;
    });
    return { urlRedireccion: this.urlRetornoApp(orden) };
  }

  /** Resultado de una orden para la página de retorno de la app (scoped a tenant). */
  async obtenerResultado(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    const rp = (orden.metadata?.resultadoPago ?? {}) as Partial<DetallePago>;
    return {
      ordenId: orden.ordenId,
      // El motivo de la pagada sin venta NO va: es del admin (`/ordenes`).
      estado: this.estadoParaLaApp(orden),
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
