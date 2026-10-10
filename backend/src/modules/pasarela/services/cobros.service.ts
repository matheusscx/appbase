import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Db } from '../../../common/db/db.service';
import { MonedasService } from '../../monedas/monedas.service';
import Decimal from 'decimal.js';
import { randomBytes } from 'crypto';
import {
  MONEDA_ORDEN_V1,
  PasarelaOrden,
} from '../entities/pasarela-orden.entity';
import { CreateCobroDto } from '../dto/create-cobro.dto';
import {
  CreateReembolsoDto,
  DevolucionLineaDto,
} from '../dto/create-reembolso.dto';
import { ResolverReembolsoDto } from '../dto/resolver-reembolso.dto';
import { GenerarNotaReembolsoDto } from '../dto/generar-nota-reembolso.dto';
import { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';
import {
  IdempotenciaService,
  type ActorIdempotente,
} from '../../idempotencia/idempotencia.service';
import { huellaDe } from '../../idempotencia/huella';
import type { QueryOrdenesDto } from '../dto/query-ordenes.dto';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import {
  ReembolsoCallbackRegistry,
  type ReembolsoAprobadoEvento,
  type ReembolsoCallbackHandler,
} from './reembolso-callback.registry';
import {
  ProviderComunicacionError,
  ResultadoCobro,
  TIMEOUT_LLAMADA_REEMBOLSO_MS,
  type ResultadoEstado,
} from '../providers/payment-provider.interface';
import type { PaginatedResponse } from '../../../common/interfaces/paginated-response.interface';
import {
  bordeFechaSql,
  bordeHastaSql,
  diaNegocioTenant,
  empujarDiaNegocio,
  requiereDiaNegocio,
  type DiaNegocio,
} from '../../../common/utils/rango-fecha.util';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../../common/utils/pagination.util';

interface OrdenListRow {
  orden_id: string;
  codigo_orden: string;
  pagador_ref: string | null;
  referencia_externa: string | null;
  venta_id: string | null;
  descripcion: string;
  monto: string;
  moneda: string;
  estado: string;
  origen: string;
  motivo_sin_venta: string | null;
  creado_el: Date;
}

const PASARELA_V1 = 'oneclick';
const EXPIRACION_ORDEN_MS = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Cuánto tiempo, desde el último intento de cobro sin respuesta (o desde la
 * orden, si el proceso murió sin anotarlo), un "no la conozco" de Transbank NO
 * significa "no se cobró" en el alta de suscripción: puede estar registrando
 * todavía un cargo que se aprobó tarde, y soltar la clave ahí habilita el
 * segundo cobro. Owner, 2026-10-10 (5 min, elegido sobre 2, 15 y "no esperar").
 */
export const VENTANA_COBRO_SIN_CONFIRMAR_MS = 5 * 60 * 1000;

/** Un REFUND en estos estados es "sin confirmar": el proveedor pudo haber devuelto la plata. */
const SIN_CONFIRMAR = ['iniciada', 'error'];

const MENSAJE_REEMBOLSO_OTROS_DATOS =
  'Este reembolso ya se había hecho con otros datos. Revisá la orden antes de reembolsar de nuevo.';

const MENSAJE_REEMBOLSO_SIN_CONFIRMAR =
  'Transbank no confirmó el reembolso: no sabemos si la plata salió. Volvé a confirmar y el sistema le va a consultar el saldo a Transbank, sin devolverla dos veces.';

const MOTIVO_NO_SALIO =
  'Transbank no hizo el reembolso: el saldo de la tarjeta no cambió. Podés reembolsar de nuevo.';

const MOTIVO_NO_SALIO_MANUAL =
  'Marcado "no salió" después de revisar el portal de Transbank.';

function mensajeNoSePuedeAclarar(monto: string): string {
  return `Hay un reembolso de $${new Decimal(monto).toString()} sin confirmar en esta orden y Transbank no pudo aclarar si salió. Revisalo en el portal de Transbank antes de volver a intentar.`;
}

/**
 * Qué dice el saldo del proveedor de un REFUND sin confirmar (ADR-029):
 * `esperado` es lo que quedaría sin anular sin ese REFUND, `despues` lo que
 * quedaría con él. Sin `balance` (el proveedor no lo informa si no hubo
 * anulaciones) decide el estado: anulada entera, o autorizada sin ningún
 * reembolso aprobado. Lo demás no se puede aclarar acá.
 */
export function veredictoPorSaldo(
  consulta: ResultadoEstado,
  esperado: Decimal,
  despues: Decimal,
  aprobado: Decimal,
): 'salio' | 'no_salio' | 'no_se_puede' {
  if (consulta.saldo !== null) {
    const saldo = new Decimal(consulta.saldo);
    if (saldo.eq(despues)) return 'salio';
    if (saldo.eq(esperado)) return 'no_salio';
    return 'no_se_puede';
  }
  const estado = consulta.estadoProveedor;
  if (despues.lte(0) && (estado === 'NULLIFIED' || estado === 'REVERSED'))
    return 'salio';
  if (aprobado.isZero() && (estado === 'AUTHORIZED' || estado === 'CAPTURED'))
    return 'no_salio';
  return 'no_se_puede';
}

const MENSAJE_NOTA_OTROS_DATOS =
  'Esta nota ya se había generado con otros datos. Revisá la orden antes de generar otra.';

const MENSAJE_YA_TIENE_NOTA = 'Este reembolso ya tiene su nota de crédito.';

/**
 * Las líneas de un pedido como las compara una huella: la cantidad normalizada
 * ("2" y "2.00" son lo mismo) y ordenadas (los mismos ítems en otro orden son
 * el mismo pedido). La respuesta de stock cuenta: recuperar o perder lo mismo
 * son dos pedidos distintos.
 */
function devolucionesNormalizadas(
  devoluciones: readonly DevolucionLineaDto[] | undefined,
): { itemId: string; cantidad: string; stock: string | null }[] {
  return [...(devoluciones ?? [])]
    .map((d) => ({
      itemId: d.itemId,
      cantidad: new Decimal(d.cantidad).toString(),
      stock: d.stock ?? null,
    }))
    .sort((a, b) =>
      a.itemId === b.itemId
        ? a.cantidad.localeCompare(b.cantidad)
        : a.itemId.localeCompare(b.itemId),
    );
}

/**
 * Lo que tx0 del alta de suscripción le deja a tx1 (ADR-029, § "El alta de
 * suscripción"): la orden ya commiteada y lo necesario para cobrar sin volver a
 * resolver la tarjeta.
 */
export interface CobroPreparado {
  ordenId: string;
  codigoOrden: string;
  monto: string;
  moneda: string;
  tenantPasarelaId: string;
  inscripcionId: string;
  username: string;
  /** Cifrado, como lo guarda la inscripción: se descifra recién al llamar. */
  identificadorExterno: string;
}

/**
 * Qué dijo Transbank de la orden de un alta cuyo cobro quedó sin confirmar:
 * `pagada` (el cargo salió), `fallida` (no salió) o `no_se_puede` (no contestó,
 * o contestó algo que no aclara).
 */
export type VeredictoCobro = 'pagada' | 'fallida' | 'no_se_puede';

/** Lo que tx0 le deja a tx1. */
interface PreparadoReembolso {
  refundId: string;
  tenantPasarelaId: string;
}

/** Lo que el hook post-commit necesita de un REFUND aprobado. */
interface CtxHookReembolso {
  orden: PasarelaOrden;
  usuarioId: string | null;
  transaccionId: string;
  monto: string;
  devoluciones: DevolucionLineaDto[];
}

@Injectable()
export class CobrosService {
  private readonly logger = new Logger(CobrosService.name);

  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly db: Db,
    private readonly inscripciones: InscripcionesService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly credenciales: CredencialesService,
    private readonly providerFactory: ProviderFactory,
    private readonly reembolsoRegistry: ReembolsoCallbackRegistry,
    private readonly monedas: MonedasService,
    private readonly idempotencia: IdempotenciaService,
  ) {}

  /** buyOrder ≤26 chars alfanumérico (límite Oneclick): 'O' + timestamp36 + 8 random. */
  private generarCodigoOrden(): string {
    return `O${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  private toPublico(
    orden: PasarelaOrden,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ordenId: orden.ordenId,
      codigoOrden: orden.codigoOrden,
      pagadorRef: orden.pagadorRef,
      referenciaExterna: orden.referenciaExterna,
      ventaId: orden.ventaId,
      descripcion: orden.descripcion,
      monto: orden.monto,
      moneda: orden.moneda,
      estado: orden.estado,
      creadoEl: orden.creadoEl,
      ...extra,
    };
  }

  async cobrar(
    tenantId: string,
    dto: CreateCobroDto,
    origen: 'interno' | 'api',
    apiKeyId?: string,
  ) {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');
    // Antes de resolver nada: más abajo la orden se PERSISTE antes de llamar al
    // proveedor, y el proveedor era el único que miraba la escala (`montoEntero`).
    // Un monto con decimales dejaba una orden 'en_proceso' huérfana —sin
    // transacción, sin nada enviado— por un error de formato del cliente.
    await this.monedas.validarEscalaDeMoneda(dto.monto, MONEDA_ORDEN_V1);

    const inscripcion = await this.inscripciones.resolverParaCobro(
      tenantId,
      dto.inscripcionId,
      dto.pagadorRef,
    );
    const { tenantPasarela, pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_V1,
      );
    const provider = this.providerFactory.getTokenizado(pasarela.codigo);

    const orden = await this.ordenRepo.save(
      this.ordenRepo.create({
        tenantId,
        pagadorRef: inscripcion.pagadorRef,
        referenciaExterna: dto.referenciaExterna ?? null,
        codigoOrden: this.generarCodigoOrden(),
        descripcion: dto.descripcion,
        monto: dto.monto,
        moneda: MONEDA_ORDEN_V1,
        estado: 'en_proceso',
        fechaExpiracion: new Date(Date.now() + EXPIRACION_ORDEN_MS),
        origen,
        apiKeyId: apiKeyId ?? null,
      }),
    );

    let resultado: ResultadoCobro;
    try {
      resultado = await provider.autorizarCobro(cred, {
        username: inscripcion.identificadorUsuarioExterno,
        identificadorExterno: this.credenciales.descifrarTexto(
          inscripcion.identificadorExterno!,
        ),
        codigoOrden: orden.codigoOrden,
        monto: dto.monto,
        moneda: MONEDA_ORDEN_V1,
        cuotas: dto.cuotas ?? 0,
      });
    } catch (e) {
      if (e instanceof ProviderComunicacionError) {
        // No sabemos si el cobro pasó: la orden QUEDA en_proceso (nunca asumir rechazo).
        await this.transacciones.registrar({
          tenantId,
          ordenId: orden.ordenId,
          tenantPasarelaId: tenantPasarela.tenantPasarelaId,
          inscripcionId: inscripcion.inscripcionId,
          tipo: 'AUTHORIZATION',
          estado: 'error',
          monto: dto.monto,
          moneda: MONEDA_ORDEN_V1,
          codigoOrden: orden.codigoOrden,
          request: e.request,
          response: e.response,
        });
        throw new BadGatewayException(
          `No se pudo confirmar el cobro (orden ${orden.ordenId}); verifique el estado con POST /pasarela/api/ordenes/${orden.ordenId}/verificar`,
        );
      }
      throw e;
    }

    await this.transacciones.registrar({
      tenantId,
      ordenId: orden.ordenId,
      tenantPasarelaId: tenantPasarela.tenantPasarelaId,
      inscripcionId: inscripcion.inscripcionId,
      tipo: 'AUTHORIZATION',
      estado: resultado.aprobada ? 'aprobada' : 'rechazada',
      monto: dto.monto,
      moneda: MONEDA_ORDEN_V1,
      codigoOrden: orden.codigoOrden,
      codigoAutorizacion: resultado.codigoAutorizacion,
      identificadorTransaccionExterno:
        resultado.identificadorTransaccionExterno,
      codigoRespuesta: resultado.codigoRespuesta,
      tipoPago: resultado.tipoPago,
      numeroCuotas: resultado.numeroCuotas,
      montoCuota: resultado.montoCuota,
      request: resultado.request,
      response: resultado.response,
    });

    orden.estado = resultado.aprobada ? 'pagada' : 'fallida';
    await this.ordenRepo.save(orden);

    return this.toPublico(orden, {
      codigoRespuesta: resultado.codigoRespuesta,
      codigoAutorizacion: resultado.codigoAutorizacion,
      tipoPago: resultado.tipoPago,
    });
  }

  /**
   * Vincula una orden ya pagada con la venta que materializó (flujo interno:
   * suscripciones/checkout cobran con `cobrar` y crean la venta después). Deja
   * la orden en 'conciliada', espejo de lo que hace el dispatcher de Webpay.
   */
  async vincularVenta(tenantId: string, ordenId: string, ventaId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'pagada')
      throw new BadRequestException(
        `Solo se puede vincular una venta a una orden pagada (estado ${orden.estado})`,
      );
    orden.ventaId = ventaId;
    orden.estado = 'conciliada';
    await this.ordenRepo.save(orden);
    return this.toPublico(orden);
  }

  /**
   * tx0 del alta de suscripción (ADR-029, § "El alta de suscripción"): los
   * chequeos que pueden rebotar y la orden en `en_proceso`, ligada al reclamo
   * de la clave (write-ahead). Corre dentro de la transacción del reclamo: un
   * 400 acá revierte los dos, sin rastro. Nada sale a Transbank.
   *
   * `cobrar` hace lo mismo y llama en el mismo paso; no se toca porque es la
   * API de la pasarela, que no pide clave (gemelo anotado en `pendientes.md`).
   */
  async prepararCobro(
    tenantId: string,
    dto: {
      inscripcionId: string;
      pagadorRef: string;
      monto: string;
      descripcion: string;
    },
    solicitudId: string,
  ): Promise<CobroPreparado> {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');
    await this.monedas.validarEscalaDeMoneda(dto.monto, MONEDA_ORDEN_V1);
    const inscripcion = await this.inscripciones.resolverParaCobro(
      tenantId,
      dto.inscripcionId,
      dto.pagadorRef,
    );
    const { tenantPasarela, pasarela } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_V1,
      );
    // Que el proveedor exista se sabe ANTES de commitear la orden.
    this.providerFactory.getTokenizado(pasarela.codigo);

    const orden = await this.ordenRepo.save(
      this.ordenRepo.create({
        tenantId,
        pagadorRef: inscripcion.pagadorRef,
        referenciaExterna: null,
        codigoOrden: this.generarCodigoOrden(),
        descripcion: dto.descripcion,
        monto: dto.monto,
        moneda: MONEDA_ORDEN_V1,
        estado: 'en_proceso',
        fechaExpiracion: new Date(Date.now() + EXPIRACION_ORDEN_MS),
        origen: 'interno',
        apiKeyId: null,
        solicitudIdempotenteId: solicitudId,
        // Con qué se cobra: si la tx del cobro muere sin dejar AUTHORIZATION,
        // el aclarado (y `/verificar`) resuelven el proveedor desde acá.
        metadata: {
          tenantPasarelaId: tenantPasarela.tenantPasarelaId,
          inscripcionId: inscripcion.inscripcionId,
        },
      }),
    );
    return {
      ordenId: orden.ordenId,
      codigoOrden: orden.codigoOrden,
      monto: orden.monto,
      moneda: orden.moneda,
      tenantPasarelaId: tenantPasarela.tenantPasarelaId,
      inscripcionId: inscripcion.inscripcionId,
      username: inscripcion.identificadorUsuarioExterno,
      identificadorExterno: inscripcion.identificadorExterno!,
    };
  }

  /**
   * tx1 del alta, con el reclamo bloqueado: bloquea la orden, cobra y la
   * cierra en `pagada` o `fallida`. Si la orden ya no está `en_proceso` (otro
   * camino la resolvió entre el COMMIT de tx0 y este lock) no llama: responde
   * lo que la orden dice.
   *
   * Un `ProviderComunicacionError` sale de acá: la tx hace rollback, la orden
   * queda `en_proceso` (es de tx0) y el llamador anota el intento fuera de la
   * tx (`anotarCobroSinConfirmar`). Anotarlo adentro no sirve: el rollback se
   * lo llevaría.
   */
  async efectuarCobro(
    tenantId: string,
    p: CobroPreparado,
    alLlamar: () => void,
  ): Promise<PasarelaOrden> {
    const orden = await this.bloquearOrden(tenantId, p.ordenId);
    if (orden.estado !== 'en_proceso') return orden;

    const { pasarela, cred } = await this.tenantPasarelaService.resolverPorId(
      p.tenantPasarelaId,
    );
    // Antes de `alLlamar`: un error acá no mandó nada a Transbank, y no tiene
    // que leerse como un cobro en duda.
    const identificadorExterno = this.credenciales.descifrarTexto(
      p.identificadorExterno,
    );
    alLlamar();
    const resultado = await this.providerFactory
      .getTokenizado(pasarela.codigo)
      .autorizarCobro(cred, {
        username: p.username,
        identificadorExterno,
        codigoOrden: orden.codigoOrden,
        monto: orden.monto,
        moneda: orden.moneda,
        cuotas: 0,
        // Se cobra con la tx abierta y el reclamo bloqueado: sin tope, un
        // Transbank colgado retendría la conexión y al reintento sin fin.
        timeoutMs: TIMEOUT_LLAMADA_REEMBOLSO_MS,
      });

    await this.transacciones.registrar({
      tenantId,
      ordenId: orden.ordenId,
      tenantPasarelaId: p.tenantPasarelaId,
      inscripcionId: p.inscripcionId,
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
      numeroCuotas: resultado.numeroCuotas,
      montoCuota: resultado.montoCuota,
      request: resultado.request,
      response: resultado.response,
    });
    orden.estado = resultado.aprobada ? 'pagada' : 'fallida';
    return this.ordenRepo.save(orden);
  }

  /**
   * Transbank no contestó el cobro del alta: se anota lo que se mandó como
   * AUTHORIZATION `error`, fuera de la tx que hizo rollback. La orden sigue
   * `en_proceso`: no es un rechazo, el cargo pudo haber salido.
   */
  async anotarCobroSinConfirmar(
    tenantId: string,
    p: CobroPreparado,
    e: ProviderComunicacionError,
  ): Promise<void> {
    await this.db.sinTransaccion(() =>
      this.transacciones.registrar({
        tenantId,
        ordenId: p.ordenId,
        tenantPasarelaId: p.tenantPasarelaId,
        inscripcionId: p.inscripcionId,
        tipo: 'AUTHORIZATION',
        estado: 'error',
        monto: p.monto,
        moneda: p.moneda,
        codigoOrden: p.codigoOrden,
        request: e.request,
        response: e.response,
      }),
    );
  }

  /**
   * El reintento de un alta cuyo reclamo quedó sin respuesta (la tx del cobro
   * murió, o Transbank no contestó): bloquea la orden del reclamo y, si sigue
   * sin resolver, le pregunta a Transbank. **Nunca vuelve a cobrar.** Consulta
   * también una `expirada`, como `/verificar`: el reloj no sabe si el cargo
   * salió. Y una `fallida`: los caminos del alta que la dejan así sueltan la
   * clave en la misma tx y nunca llegan acá, así que la puso otro lector
   * (`/verificar` de la API, el abort de un retorno) sin mirar la ventana de un
   * "no la conozco". Creerle soltaría la clave con un cargo quizá aprobado.
   *
   * Si salió, la orden queda `pagada` con su AUTHORIZATION `aprobada` (sin
   * código: se perdió con la respuesta). Sin esa fila la orden no se podría
   * reembolsar. Corre en la transacción del reclamo: si lo que sigue falla,
   * todo vuelve a `en_proceso` y el próximo reintento consulta de nuevo.
   */
  async aclararCobro(
    tenantId: string,
    solicitudId: string,
  ): Promise<{ veredicto: VeredictoCobro; orden: PasarelaOrden }> {
    const delReclamo = await this.ordenRepo.findOne({
      where: { tenantId, solicitudIdempotenteId: solicitudId },
    });
    // tx0 escribe reclamo y orden juntos: uno sin la otra es que algo rompió
    // esa atomicidad. 500, nunca un falso "ya estaba activa".
    if (!delReclamo)
      throw new InternalServerErrorException('Reclamo de cobro sin su orden');
    const orden = await this.bloquearOrden(tenantId, delReclamo.ordenId);
    const tenantPasarelaId = orden.metadata?.tenantPasarelaId;
    const inscripcionId = orden.metadata?.inscripcionId;
    if (typeof tenantPasarelaId !== 'string')
      throw new InternalServerErrorException(
        'La orden del alta no sabe con qué pasarela se cobró',
      );

    if (orden.estado !== 'pagada') {
      // `conciliada` o `reembolsada` sin respuesta guardada no puede pasar:
      // conciliar va en la misma tx que la respuesta.
      if (!['en_proceso', 'expirada', 'fallida'].includes(orden.estado))
        throw new InternalServerErrorException(
          `La orden del alta está ${orden.estado} y su reclamo no tiene respuesta`,
        );
      let consulta: ResultadoEstado;
      try {
        const { pasarela, cred } =
          await this.tenantPasarelaService.resolverPorId(tenantPasarelaId);
        consulta = await this.providerFactory
          .getTokenizado(pasarela.codigo)
          .consultarEstado(cred, {
            codigoOrden: orden.codigoOrden,
            tokenProveedor: orden.tokenProveedor,
          });
      } catch (e) {
        if (!(e instanceof ProviderComunicacionError)) throw e;
        this.logger.warn(
          `No se pudo consultar el cobro sin confirmar de la orden ${orden.ordenId}: ${e.message}`,
        );
        return { veredicto: 'no_se_puede', orden };
      }
      if (consulta.estado === 'desconocido') {
        this.logger.warn(
          `La consulta no aclara el cobro de la orden ${orden.ordenId}: estado ${consulta.estadoProveedor}`,
        );
        return { veredicto: 'no_se_puede', orden };
      }
      if (
        consulta.noEncontrada &&
        (await this.dentroDeLaVentanaSinConfirmar(orden))
      ) {
        this.logger.warn(
          `Transbank todavía no conoce la orden ${orden.ordenId}: dentro de la ventana no vale como "no se cobró"`,
        );
        return { veredicto: 'no_se_puede', orden };
      }
      orden.estado = consulta.estado;
      orden.metadata = {
        ...orden.metadata,
        verificacion: this.transacciones.redactar(consulta.response),
      };
      await this.ordenRepo.save(orden);
      if (consulta.estado === 'fallida') return { veredicto: 'fallida', orden };
    }

    // `pagada`: por la consulta de recién, o por un `/verificar` de la API.
    const historial = await this.transacciones.listarPorOrden(
      tenantId,
      orden.ordenId,
    );
    if (
      !historial.some(
        (t) => t.tipo === 'AUTHORIZATION' && t.estado === 'aprobada',
      )
    )
      await this.transacciones.registrar({
        tenantId,
        ordenId: orden.ordenId,
        tenantPasarelaId,
        inscripcionId: typeof inscripcionId === 'string' ? inscripcionId : null,
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        monto: orden.monto,
        moneda: orden.moneda,
        codigoOrden: orden.codigoOrden,
        identificadorTransaccionExterno: orden.codigoOrden,
        response: orden.metadata.verificacion as Record<string, unknown>,
      });
    return { veredicto: 'pagada', orden };
  }

  /**
   * ¿Pasó menos de `VENTANA_COBRO_SIN_CONFIRMAR_MS` desde el último intento
   * de cobro sin respuesta de la orden (su AUTHORIZATION `error`)? Sin uno —el
   * proceso murió sin anotarlo—, se cuenta desde que se creó la orden.
   */
  private async dentroDeLaVentanaSinConfirmar(
    orden: PasarelaOrden,
  ): Promise<boolean> {
    const historial = await this.transacciones.listarPorOrden(
      orden.tenantId,
      orden.ordenId,
    );
    const desde =
      historial
        .filter((t) => t.tipo === 'AUTHORIZATION' && t.estado === 'error')
        .map((t) => t.fechaTransaccion)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? orden.creadoEl;
    return Date.now() - desde.getTime() < VENTANA_COBRO_SIN_CONFIRMAR_MS;
  }

  /**
   * Un reembolso por intento, aunque el admin (o la app de la llave de API)
   * confirme dos veces: **at-most-once** contra el proveedor (ADR-029).
   *
   * El proveedor no está en la transacción y Transbank no acepta clave de
   * idempotencia, así que el reclamo de la clave y el REFUND en `iniciada` se
   * commitean ANTES de llamar (`IdempotenciaService.ejecutarConEfectoExterno`):
   * - **aclarar**: si la orden tiene un REFUND sin confirmar, se aclara antes
   *   de reclamar (consulta de saldo); si no se puede, 409. Con como mucho uno
   *   sin confirmar por orden, el saldo dice cuál salió;
   * - **preparar** (tx0): chequeos que rebotan con 400 sin dejar rastro, y el
   *   REFUND write-ahead;
   * - **efectuar** (tx1): con el reclamo y la orden bloqueados, relee SU
   *   REFUND, re-verifica, llama al proveedor y cierra la fila;
   * - **resolverSinConfirmar**: el reintento de un intento que no llegó a
   *   confirmarse responde el estado final de su REFUND, aclarándolo si hace
   *   falta. Nunca vuelve a llamar a `reembolsar` del proveedor.
   */
  async reembolsar(
    tenantId: string,
    ordenId: string,
    dto: CreateReembolsoDto,
    actor: ActorIdempotente,
    clave: string,
  ): Promise<Record<string, unknown>> {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');
    // Mismo borde que en `cobrar`, y por la misma razón: sin esto el 400 sale
    // de adentro del proveedor con un mensaje que nombra a Transbank, no al
    // monto. Va contra `MONEDA_ORDEN_V1` y no contra `orden.moneda`, aunque acá
    // la orden existe: la moneda de una orden la escribe ESTE código desde la
    // constante, así que hoy no pueden diferir, y validarlo antes no abre
    // ninguna transacción. El día que la moneda de la orden deje de salir de la
    // constante, esto pasa a `preparar` y lee `orden.moneda` (`Db.query`
    // resuelve el manager activo: no abre otra conexión).
    await this.monedas.validarEscalaDeMoneda(dto.monto, MONEDA_ORDEN_V1);
    const usuarioId = 'usuarioId' in actor ? actor.usuarioId : null;

    // Decisión 4 del owner: otro reembolso de la orden espera a que el que
    // quedó sin confirmar se aclare. Va en su propia transacción, antes del
    // reclamo, para que un 400 posterior (el disponible) no se lleve puesto el
    // aclarado.
    //
    // Si NO se puede aclarar, el 409 no sale de acá: el reclamo sigue mandando
    // (ADR-026). El reintento de un reembolso que ya salió tiene que reproducir
    // aunque la orden tenga OTRO sin confirmar, y un intento nuevo rebota con
    // el mismo 409 en `preparar` (`verificarReembolsable`), sin reclamar.
    await this.aclararSinConfirmarDeLaOrden(tenantId, ordenId, usuarioId).catch(
      (e: unknown) => {
        if (!(e instanceof ConflictException)) throw e;
      },
    );

    // El REFUND al que el proveedor pudo haber devuelto la plata sin que nos
    // enteremos: si la llamada falla por comunicación, se anota sobre él.
    let llamado: string | undefined;
    // Lo que el hook post-commit necesita: solo si ESTE request cerró un
    // REFUND aprobado (la reproducción no escribe, ADR-026).
    let paraElHook: CtxHookReembolso | undefined;

    try {
      const { origen, respuesta } =
        await this.idempotencia.ejecutarConEfectoExterno<
          PreparadoReembolso,
          Record<string, unknown>
        >(
          {
            tenantId,
            actor,
            clave,
            operacion: 'pasarela.reembolso',
            // Lo que el request pidió, campo por campo; la ruta del admin y la
            // de la API arman la misma. El monto va normalizado ("17000" y
            // "17000.00" son el mismo reembolso) y las devoluciones ordenadas:
            // los mismos ítems en otro orden son el mismo pedido.
            huella: huellaDe('pasarela.reembolso', {
              ordenId,
              monto: new Decimal(dto.monto).toString(),
              devoluciones: devolucionesNormalizadas(dto.devoluciones),
            }),
            mensajeOtrosDatos: MENSAJE_REEMBOLSO_OTROS_DATOS,
          },
          {
            preparar: (solicitudId) =>
              this.prepararReembolso(
                tenantId,
                ordenId,
                dto,
                solicitudId,
                actor,
              ),
            efectuar: async (_solicitudId, preparado) => {
              const r = await this.efectuarReembolso(
                tenantId,
                ordenId,
                dto,
                preparado,
                usuarioId,
                () => {
                  llamado = preparado.refundId;
                },
              );
              if ('hook' in r) paraElHook = r.hook;
              return r.resultado;
            },
            resolverSinConfirmar: async (solicitudId) => {
              const r = await this.resolverReembolsoSinConfirmar(
                tenantId,
                solicitudId,
                usuarioId,
              );
              if ('hook' in r) paraElHook = r.hook;
              return { respuesta: r.respuesta };
            },
            cuerpoOtrosDatos: async (solicitudId) => ({
              ordenId:
                (
                  await this.transacciones.reembolsoDeSolicitud(
                    tenantId,
                    solicitudId,
                  )
                )?.ordenId ?? null,
            }),
          },
        );

      if (origen === 'reproducida')
        return await this.conCorreccionActual(tenantId, respuesta);
      // Sin hook propio, el REFUND lo cerró otro camino (típicamente el
      // aclarado previo de la orden, que ya dejó su corrección): se informa la
      // que tiene hoy, como en la reproducción.
      const final = paraElHook
        ? await this.aplicarPostReembolso(respuesta, paraElHook)
        : await this.conCorreccionActual(tenantId, respuesta);
      // Un intento sin confirmar que resultó aprobado se ve como la primera
      // respuesta perdida: "ya se había hecho" (decisión 1 del owner).
      return origen === 'resuelta' && final.reembolsoAprobado === true
        ? { ...final, repetida: true }
        : final;
    } catch (e) {
      if (e instanceof ProviderComunicacionError && llamado) {
        // tx1 hizo rollback y soltó los locks: el REFUND sigue en `iniciada`
        // (commiteado en tx0) y el reclamo sin respuesta. Se anota lo que se
        // mandó y lo que volvió; el estado no cambia: no es un rechazo.
        await this.transacciones.registrarIntentoSinConfirmar(
          tenantId,
          llamado,
          { request: e.request, response: e.response },
        );
        throw new BadGatewayException(MENSAJE_REEMBOLSO_SIN_CONFIRMAR);
      }
      throw e;
    }
  }

  /**
   * tx0: lo que puede rebotar con 400 antes de comprometer nada, y el REFUND
   * en `iniciada` (write-ahead) ligado al reclamo.
   */
  private async prepararReembolso(
    tenantId: string,
    ordenId: string,
    dto: CreateReembolsoDto,
    solicitudId: string,
    actor: ActorIdempotente,
  ): Promise<PreparadoReembolso> {
    const { orden, autorizacion } = await this.verificarReembolsable(
      tenantId,
      ordenId,
      dto.monto,
      null,
    );
    // Las devoluciones, como las valida la nota manual —y sobre todo la
    // pregunta "¿se recupera o se pierde?" de cada línea con stock—, ANTES del
    // proveedor: el hook post-commit ya no puede rechazar nada, y una línea sin
    // respuesta saldría sin reponer ni mermar. Solo acá, en tx0: las líneas de
    // la venta no cambian entre tx0 y tx1.
    const devoluciones = dto.devoluciones ?? [];
    const ventaId = orden.ventaId;
    const handler =
      ventaId && devoluciones.length ? this.reembolsoRegistry.get() : null;
    if (ventaId && handler)
      await this.db.transaccion((manager) =>
        handler.validarDevoluciones(manager, {
          tenantId,
          ventaId,
          devoluciones,
        }),
      );
    const refund = await this.transacciones.registrar({
      tenantId,
      ordenId,
      tenantPasarelaId: autorizacion.tenantPasarelaId,
      inscripcionId: autorizacion.inscripcionId,
      transaccionPadreId: autorizacion.transaccionId,
      solicitudIdempotenteId: solicitudId,
      // Quién lo pidió: la corrección se le atribuye aunque lo aclare otro.
      usuarioId: 'usuarioId' in actor ? actor.usuarioId : null,
      apiKeyId: 'apiKeyId' in actor ? actor.apiKeyId : null,
      tipo: 'REFUND',
      estado: 'iniciada',
      monto: dto.monto,
      moneda: orden.moneda,
      codigoOrden: orden.codigoOrden,
      // Si la respuesta se pierde y el reembolso se aclara por saldo desde
      // OTRO request, la corrección necesita lo que este pidió.
      metadata: { devoluciones: dto.devoluciones ?? [] },
    });
    return {
      refundId: refund.transaccionId,
      tenantPasarelaId: autorizacion.tenantPasarelaId,
    };
  }

  /**
   * tx1, con la fila del reclamo bloqueada: bloquea la orden, relee SU
   * REFUND, re-verifica, llama al proveedor y cierra la fila.
   */
  private async efectuarReembolso(
    tenantId: string,
    ordenId: string,
    dto: CreateReembolsoDto,
    preparado: PreparadoReembolso,
    usuarioId: string | null,
    alLlamar: () => void,
  ): Promise<{
    resultado: { respuesta: Record<string, unknown> } | { soltar: Error };
    hook?: CtxHookReembolso;
  }> {
    const bloqueada = await this.bloquearOrden(tenantId, ordenId);
    // Entre el COMMIT de tx0 y este lock la orden estuvo libre: otro reembolso
    // pudo aclarar este REFUND por saldo ("no salió") y cerrarlo. Si ya no está
    // en `iniciada`, llamar ahora devolvería plata con la fila diciendo otra
    // cosa: se responde lo que la fila dice.
    const propio = await this.refundDeLaOrden(
      tenantId,
      ordenId,
      preparado.refundId,
    );
    if (propio.estado !== 'iniciada')
      return {
        resultado: { respuesta: this.publicoDeReembolso(bloqueada, propio) },
      };

    // Lo de tx0 pudo cambiar en el medio (la carrera rara): si ya no se puede,
    // el REFUND se cierra "no se envió" y la clave se suelta —el mismo pedido
    // corregido vuelve a entrar—. Nunca se borra la fila (invariante 3).
    let verificado: Awaited<ReturnType<CobrosService['verificarReembolsable']>>;
    try {
      verificado = await this.verificarReembolsable(
        tenantId,
        ordenId,
        dto.monto,
        preparado.refundId,
      );
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      const cerrada = await this.transacciones.resolverReembolso(
        tenantId,
        propio.transaccionId,
        {
          estado: 'rechazada',
          resolucion: 'no_enviado',
          resueltaPor: usuarioId,
          metadata: { motivo: `No se envió: ${e.message}` },
        },
      );
      if (!cerrada)
        return {
          resultado: {
            respuesta: this.publicoDeReembolso(
              bloqueada,
              await this.refundDeLaOrden(
                tenantId,
                ordenId,
                propio.transaccionId,
              ),
            ),
          },
        };
      return { resultado: { soltar: e } };
    }

    const { orden, yaReembolsado } = verificado;
    const { pasarela, cred } = await this.tenantPasarelaService.resolverPorId(
      preparado.tenantPasarelaId,
    );
    alLlamar();
    // Un ProviderComunicacionError sale de la transacción: tx1 hace rollback,
    // el REFUND queda en `iniciada` y el reclamo sin respuesta —"sin
    // confirmar"—, y el catch de `reembolsar` anota el intento fuera de la tx.
    // Anotarlo acá adentro no sirve: el rollback se lo llevaría.
    const resultado = await this.providerFactory
      .getReembolsable(pasarela.codigo)
      .reembolsar(cred, {
        codigoOrden: orden.codigoOrden,
        monto: dto.monto,
        tokenProveedor: orden.tokenProveedor,
      });

    const cerrada = await this.transacciones.resolverReembolso(
      tenantId,
      propio.transaccionId,
      {
        estado: resultado.aprobada ? 'aprobada' : 'rechazada',
        resolucion: 'proveedor',
        resueltaPor: usuarioId,
        codigoRespuesta: resultado.codigoRespuesta,
        codigoAutorizacion: resultado.codigoAutorizacion,
        tipoPago: resultado.tipoPago,
        request: resultado.request,
        response: resultado.response,
      },
    );
    if (!cerrada) {
      // Con el reclamo y la orden bloqueados nadie más puede cerrarla: si pasa,
      // es un camino nuevo que no toma la orden. No se pisa lo que dejó; se
      // responde la fila y se deja el rastro.
      this.logger.error(
        `El REFUND ${propio.transaccionId} ya estaba resuelto al volver Transbank (${resultado.aprobada ? 'aprobado' : 'rechazado'} por el proveedor)`,
      );
      return {
        resultado: {
          respuesta: this.publicoDeReembolso(
            orden,
            await this.refundDeLaOrden(tenantId, ordenId, propio.transaccionId),
          ),
        },
      };
    }
    if (resultado.aprobada && yaReembolsado.plus(dto.monto).gte(orden.monto)) {
      orden.estado = 'reembolsada';
      await this.ordenRepo.save(orden);
    }
    const cerrado = await this.refundDeLaOrden(
      tenantId,
      ordenId,
      propio.transaccionId,
    );
    return {
      resultado: { respuesta: this.publicoDeReembolso(orden, cerrado) },
      ...(resultado.aprobada && {
        hook: this.ctxHookDe(orden, cerrado),
      }),
    };
  }

  /**
   * El reclamo de la clave existe y no tiene respuesta: la tx1 que lo hizo
   * murió, o el proveedor no contestó. Responde el estado final de SU REFUND;
   * si sigue sin confirmar, lo aclara por saldo. Corre dentro de la
   * transacción de `IdempotenciaService`, con el reclamo bloqueado.
   */
  private async resolverReembolsoSinConfirmar(
    tenantId: string,
    solicitudId: string,
    usuarioId: string | null,
  ): Promise<{ respuesta: Record<string, unknown>; hook?: CtxHookReembolso }> {
    const refund = await this.transacciones.reembolsoDeSolicitud(
      tenantId,
      solicitudId,
    );
    // tx0 escribe reclamo y REFUND juntos: un reclamo sin REFUND es que algo
    // rompió esa atomicidad. 500, nunca un falso "ya se había hecho".
    if (!refund?.ordenId)
      throw new InternalServerErrorException(
        'Reclamo de reembolso sin su REFUND',
      );
    const orden = await this.bloquearOrden(tenantId, refund.ordenId);
    // Releído con la orden bloqueada: un aclarado ajeno pudo cerrarlo recién.
    const actual = await this.refundDeLaOrden(
      tenantId,
      orden.ordenId,
      refund.transaccionId,
    );
    if (!SIN_CONFIRMAR.includes(actual.estado))
      // Ya lo cerró otro camino (el aclarado de otro request): se responde eso.
      // Su corrección, si correspondía, la dejó quien lo cerró.
      return { respuesta: this.publicoDeReembolso(orden, actual) };

    const aclarado = await this.aclararReembolso(orden, actual, usuarioId);
    if (aclarado === 'ya_resuelto')
      return {
        respuesta: this.publicoDeReembolso(
          orden,
          await this.refundDeLaOrden(
            tenantId,
            orden.ordenId,
            actual.transaccionId,
          ),
        ),
      };
    if (aclarado === 'no_se_puede')
      throw new ConflictException(mensajeNoSePuedeAclarar(actual.monto ?? '0'));
    const cerrado = await this.refundDeLaOrden(
      tenantId,
      orden.ordenId,
      actual.transaccionId,
    );
    return {
      respuesta: this.publicoDeReembolso(orden, cerrado),
      ...(aclarado === 'salio' && { hook: this.ctxHookDe(orden, cerrado) }),
    };
  }

  /**
   * Decisión 4 del owner: antes de otro reembolso, se aclara el que quedó sin
   * confirmar. Si salió, su corrección se deja como la de cualquier REFUND
   * aprobado (post-commit, atribuida a quien PIDIÓ el reembolso, no a quien lo
   * aclaró). Si no se puede aclarar, 409 y no se reclama nada. Lo usa también
   * "Volver a consultar" del drawer de la orden.
   */
  private async aclararSinConfirmarDeLaOrden(
    tenantId: string,
    ordenId: string,
    usuarioId: string | null,
  ): Promise<{
    aclarado: 'salio' | 'no_salio' | 'ya_resuelto' | null;
    warning?: string;
  }> {
    const r = await this.db.transaccion(async () => {
      const orden = await this.ordenRepo.findOne({
        where: { ordenId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      // Sin orden, el 404 lo da quien llamó, con su mensaje de siempre.
      if (!orden) return { aclarado: null };
      const pendientes = (
        await this.transacciones.listarPorOrden(tenantId, ordenId)
      ).filter((t) => t.tipo === 'REFUND' && SIN_CONFIRMAR.includes(t.estado));
      if (pendientes.length === 0) return { aclarado: null };
      const aclarado =
        pendientes.length === 1
          ? await this.aclararReembolso(orden, pendientes[0], usuarioId)
          : 'no_se_puede';
      if (aclarado === 'no_se_puede')
        throw new ConflictException(
          mensajeNoSePuedeAclarar(
            pendientes
              .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0))
              .toString(),
          ),
        );
      if (aclarado !== 'salio') return { aclarado };
      return {
        aclarado,
        hook: this.ctxHookDe(
          orden,
          await this.refundDeLaOrden(
            tenantId,
            ordenId,
            pendientes[0].transaccionId,
          ),
        ),
      };
    });
    if (!('hook' in r) || !r.hook) return { aclarado: r.aclarado };
    const conHook = await this.aplicarPostReembolso({}, r.hook);
    return {
      aclarado: r.aclarado,
      ...(typeof conHook.warning === 'string' && { warning: conHook.warning }),
    };
  }

  /**
   * "Volver a consultar" (decisión del owner, 2026-10-04): aclara por saldo el
   * reembolso sin confirmar de la orden y devuelve la orden como quedó. Si no se
   * puede aclarar, 409: la pantalla ofrece entonces marcarlo a mano.
   */
  async aclararReembolsoSinConfirmar(
    tenantId: string,
    ordenId: string,
    usuarioId: string,
  ): Promise<Record<string, unknown>> {
    const { aclarado, warning } = await this.aclararSinConfirmarDeLaOrden(
      tenantId,
      ordenId,
      usuarioId,
    );
    return {
      ...(await this.obtenerOrden(tenantId, ordenId, { vistaAdmin: true })),
      aclarado,
      ...(warning && { warning }),
    };
  }

  /**
   * El admin revisó el portal de Transbank y marca el reembolso sin confirmar
   * (decisión del owner, 2026-10-04): "Salió" —con el código de autorización
   * que muestra el portal— lo aprueba y deja su corrección como cualquier
   * reembolso aprobado; "No salió" lo rechaza y destraba la orden. Queda quién
   * y cuándo (`resolucion = 'manual'`). Una sola vez: un segundo clic o una
   * consulta que lo cerró en el medio dan 409, sin tocar nada.
   */
  async resolverReembolsoAMano(
    tenantId: string,
    ordenId: string,
    transaccionId: string,
    dto: ResolverReembolsoDto,
    usuarioId: string,
  ): Promise<Record<string, unknown>> {
    const r = await this.db.transaccion(async () => {
      const orden = await this.bloquearOrden(tenantId, ordenId);
      const historial = await this.transacciones.listarPorOrden(
        tenantId,
        ordenId,
      );
      const refund = historial.find(
        (t) => t.transaccionId === transaccionId && t.tipo === 'REFUND',
      );
      if (!refund) throw new NotFoundException('Reembolso no encontrado');
      if (!SIN_CONFIRMAR.includes(refund.estado))
        throw new ConflictException(
          `Este reembolso ya estaba resuelto (${refund.estado})`,
        );
      const aprobado = historial
        .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
        .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
      const despues = aprobado.plus(refund.monto ?? '0');
      if (dto.salio && despues.gt(orden.monto))
        throw new BadRequestException(
          'Ese reembolso no puede haber salido: con él se devolvería más que el monto de la orden. Revisá el portal de Transbank.',
        );
      const cerrada = await this.transacciones.resolverReembolso(
        tenantId,
        transaccionId,
        dto.salio
          ? {
              estado: 'aprobada',
              resolucion: 'manual',
              resueltaPor: usuarioId,
              codigoAutorizacion: dto.codigoAutorizacion ?? null,
            }
          : {
              estado: 'rechazada',
              resolucion: 'manual',
              resueltaPor: usuarioId,
              metadata: { motivo: MOTIVO_NO_SALIO_MANUAL },
            },
      );
      if (!cerrada)
        throw new ConflictException('Este reembolso ya estaba resuelto');
      if (dto.salio && despues.gte(orden.monto)) {
        orden.estado = 'reembolsada';
        await this.ordenRepo.save(orden);
      }
      const final = await this.refundDeLaOrden(
        tenantId,
        ordenId,
        transaccionId,
      );
      return {
        publico: this.publicoDeReembolso(orden, final),
        hook: dto.salio ? this.ctxHookDe(orden, final) : undefined,
      };
    });
    return r.hook ? this.aplicarPostReembolso(r.publico, r.hook) : r.publico;
  }

  /**
   * Aclara un REFUND sin confirmar con el saldo que informa el proveedor,
   * bajo el `FOR UPDATE` de la orden (que el llamador ya tomó). Es
   * determinista porque hay como mucho UN sin confirmar por orden:
   * `esperado = monto − Σ aprobados`, y el saldo es `esperado − monto` (salió)
   * o `esperado` (no salió). Cualquier otra cosa —un reembolso hecho a mano en
   * el portal, la consulta vencida (Webpay Plus, 7 días) o que no responda—
   * no se puede aclarar acá. Consultar no es reintentar: nunca llama a
   * `reembolsar` del proveedor.
   */
  private async aclararReembolso(
    orden: PasarelaOrden,
    refund: PasarelaTransaccion,
    usuarioId: string | null,
  ): Promise<'salio' | 'no_salio' | 'no_se_puede' | 'ya_resuelto'> {
    const historial = await this.transacciones.listarPorOrden(
      orden.tenantId,
      orden.ordenId,
    );
    const aprobado = historial
      .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
      .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
    const esperado = new Decimal(orden.monto).minus(aprobado);
    const despues = esperado.minus(refund.monto ?? '0');

    let consulta: ResultadoEstado;
    try {
      const { pasarela, cred } = await this.tenantPasarelaService.resolverPorId(
        refund.tenantPasarelaId,
      );
      consulta = await this.providerFactory
        .getReembolsable(pasarela.codigo)
        .consultarEstado(cred, {
          codigoOrden: orden.codigoOrden,
          tokenProveedor: orden.tokenProveedor,
        });
    } catch (e) {
      if (e instanceof ProviderComunicacionError) {
        this.logger.warn(
          `No se pudo consultar el saldo para aclarar el REFUND ${refund.transaccionId}: ${e.message}`,
        );
        return 'no_se_puede';
      }
      throw e;
    }

    const veredicto = veredictoPorSaldo(consulta, esperado, despues, aprobado);
    if (veredicto === 'no_se_puede') {
      this.logger.warn(
        `El saldo no aclara el REFUND ${refund.transaccionId} (orden ${orden.ordenId}): estado ${consulta.estadoProveedor}, saldo ${consulta.saldo}, esperado ${esperado.toString()}`,
      );
      return 'no_se_puede';
    }
    const cerrada = await this.transacciones.resolverReembolso(
      orden.tenantId,
      refund.transaccionId,
      {
        estado: veredicto === 'salio' ? 'aprobada' : 'rechazada',
        resolucion: 'saldo',
        resueltaPor: usuarioId,
        response: consulta.response,
        ...(veredicto === 'no_salio' && {
          metadata: { motivo: MOTIVO_NO_SALIO },
        }),
      },
    );
    // Otro la cerró en el medio: su corrección, si correspondía, es de él.
    if (!cerrada) return 'ya_resuelto';
    if (veredicto === 'salio' && despues.lte(0)) {
      orden.estado = 'reembolsada';
      await this.ordenRepo.save(orden);
    }
    return veredicto;
  }

  /**
   * Los chequeos de un reembolso, con la orden bloqueada: estado, autorización,
   * disponible y el tope por pago del lado de ventas. Corre en tx0 (rebota sin
   * rastro) y otra vez en tx1 (pudo cambiar), donde `propio` excluye el REFUND
   * en `iniciada` de este mismo intento de la cuenta de sin confirmar.
   */
  private async verificarReembolsable(
    tenantId: string,
    ordenId: string,
    monto: string,
    propio: string | null,
  ): Promise<{
    orden: PasarelaOrden;
    autorizacion: PasarelaTransaccion;
    yaReembolsado: Decimal;
  }> {
    const orden = await this.bloquearOrden(tenantId, ordenId);
    // 'conciliada' = pagada + venta materializada (checkout online): también reembolsable
    if (!['pagada', 'conciliada', 'reembolsada'].includes(orden.estado))
      throw new BadRequestException(
        `No se puede reembolsar una orden ${orden.estado}`,
      );

    // Leído tras adquirir el lock: ve los REFUND ya commiteados por un
    // reembolso concurrente previo (READ COMMITTED).
    const historial = await this.transacciones.listarPorOrden(
      tenantId,
      ordenId,
    );
    const autorizacion = historial.find(
      (t) => t.tipo === 'AUTHORIZATION' && t.estado === 'aprobada',
    );
    if (!autorizacion)
      throw new BadRequestException(
        'La orden no tiene una autorización aprobada',
      );
    // El aclarado previo dejó la orden sin pendientes; si aparece uno es otro
    // reembolso que entró en el medio, y con dos en duda el saldo ya no dice
    // cuál salió.
    const otroSinConfirmar = historial.find(
      (t) =>
        t.tipo === 'REFUND' &&
        SIN_CONFIRMAR.includes(t.estado) &&
        t.transaccionId !== propio,
    );
    if (otroSinConfirmar)
      throw new ConflictException(
        mensajeNoSePuedeAclarar(otroSinConfirmar.monto ?? '0'),
      );

    const yaReembolsado = historial
      .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
      .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
    const disponible = new Decimal(orden.monto).minus(yaReembolsado);
    if (new Decimal(monto).gt(disponible))
      throw new BadRequestException(
        `El monto excede lo disponible para reembolso (${disponible.toString()})`,
      );

    // El tope por pago, del lado de ventas: la nota "por el pago" de Webpay
    // hecha desde el POS ya devolvió esa plata, y el proveedor la sacaría de
    // nuevo. Va ANTES de llamar al proveedor (después ya no hay vuelta atrás) y
    // bajo el lock de la orden que ya tenemos.
    //
    // ⚠️ Orden de bloqueo: orden → venta, siempre. Medido: ningún camino toma
    // la venta y después la orden (la venta online se crea y COMMITEA antes de
    // que el dispatcher o `vincularVenta` toquen la orden; ventas solo lee
    // `pasarela_*` sin lock), así que no hay ciclo. Quien algún día toque la
    // orden dentro de una transacción que ya tiene `FOR UPDATE` sobre la venta
    // cierra el ciclo. Sin handler (ventas no registrado) no hay lado de ventas
    // que topar: el aviso de `aplicarPostReembolso` ya lo dice.
    //
    // Los REFUND sin confirmar de la venta gastan ese tope (pudieron haber
    // devuelto la plata); en tx1 el propio ya está en `iniciada` y no se cuenta a
    // sí mismo: por id (`propio`), así que otro sin confirmar sí cuenta.
    const handler = this.reembolsoRegistry.get();
    const ventaId = orden.ventaId;
    if (ventaId && handler)
      // `db.transaccion` reusa la activa: es para tener su manager.
      await this.db.transaccion((manager) =>
        handler.exigirTopeDelReembolso(manager, {
          tenantId,
          ventaId,
          monto,
          excluirReembolsoId: propio,
        }),
      );
    return { orden, autorizacion, yaReembolsado };
  }

  /** `SELECT … FOR UPDATE` de la orden, en la transacción activa. */
  private async bloquearOrden(
    tenantId: string,
    ordenId: string,
  ): Promise<PasarelaOrden> {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    return orden;
  }

  private async refundDeLaOrden(
    tenantId: string,
    ordenId: string,
    transaccionId: string,
  ): Promise<PasarelaTransaccion> {
    const refund = (
      await this.transacciones.listarPorOrden(tenantId, ordenId)
    ).find((t) => t.transaccionId === transaccionId);
    if (!refund)
      throw new InternalServerErrorException(
        `REFUND ${transaccionId} no encontrado en su orden`,
      );
    return refund;
  }

  private publicoDeReembolso(
    orden: PasarelaOrden,
    refund: PasarelaTransaccion,
  ): Record<string, unknown> {
    const motivo = refund.metadata?.motivo;
    return this.toPublico(orden, {
      reembolsoAprobado: refund.estado === 'aprobada',
      reembolso: {
        transaccionId: refund.transaccionId,
        tipo: refund.tipo,
        estado: refund.estado,
        monto: refund.monto,
        codigoAutorizacion: refund.codigoAutorizacion,
        codigoRespuesta: refund.codigoRespuesta,
        fechaTransaccion: refund.fechaTransaccion,
        resolucion: refund.resolucion,
      },
      ...(typeof motivo === 'string' && { motivo }),
    });
  }

  private ctxHookDe(
    orden: PasarelaOrden,
    refund: PasarelaTransaccion,
  ): CtxHookReembolso {
    const devoluciones = refund.metadata?.devoluciones;
    return {
      orden,
      // La corrección es de quien PIDIÓ el reembolso (null: llave de API o
      // fila de antes), no de quien lo aclaró o lo marcó.
      usuarioId: refund.usuarioId,
      transaccionId: refund.transaccionId,
      // La fila trae escala 6 ("17000.000000"); la corrección recibe el monto
      // como lo pidió el request.
      monto: new Decimal(refund.monto ?? '0').toString(),
      devoluciones: Array.isArray(devoluciones)
        ? (devoluciones as DevolucionLineaDto[])
        : [],
    };
  }

  /**
   * La reproducción devuelve lo que se contestó, más la corrección que el
   * REFUND tiene HOY: la respuesta guardada es la de la transacción del
   * reembolso, y la corrección se crea después del commit. Si la orden tiene
   * venta y el REFUND aprobado no tiene corrección ligada, se dice
   * (`correccionPendiente`): reproducir no la crea (ADR-026: no escribe).
   */
  private async conCorreccionActual(
    tenantId: string,
    respuesta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const reembolso = respuesta.reembolso as
      | { transaccionId?: string }
      | undefined;
    const ordenId = respuesta.ordenId as string | undefined;
    if (!reembolso?.transaccionId || !ordenId) return respuesta;
    const refund = (
      await this.transacciones.listarPorOrden(tenantId, ordenId)
    ).find((t) => t.transaccionId === reembolso.transaccionId);
    if (refund?.estado !== 'aprobada' || !respuesta.ventaId) return respuesta;
    return refund.correccionVentaId
      ? { ...respuesta, notaCreditoId: refund.correccionVentaId }
      : { ...respuesta, correccionPendiente: true };
  }

  /**
   * Hook post-commit del reembolso: todo REFUND aprobado de una orden con venta
   * deja su corrección en ventas (con las devoluciones de stock pedidas dentro)
   * y el REFUND queda ligado a ella (`correccion_venta_id`). El REFUND ya está
   * commiteado y la plata ya volvió al cliente, así que un fallo aquí NUNCA
   * revierte el reembolso: se degrada a `warning` en la respuesta + log, y el
   * REFUND queda sin corrección ligada.
   *
   * El vínculo se escribe dentro de la transacción de la corrección
   * (`ligarCorreccion`), así que hay dos estados y no tres: corrección ligada, o
   * ni corrección ni vínculo. El tercero —corrección commiteada y REFUND sin
   * ligar— hacía que el tope del pago descontara dos veces lo mismo.
   */
  private async aplicarPostReembolso(
    publico: Record<string, unknown>,
    ctx: CtxHookReembolso,
  ): Promise<Record<string, unknown>> {
    // Una orden sin venta (cobro por la API externa, sin venta ligada) no tiene
    // lado de ventas que corregir: es legítimo y no es un aviso. Solo avisa si
    // se pidieron devoluciones de stock, que sin venta no se pueden aplicar.
    if (!ctx.orden.ventaId)
      return ctx.devoluciones.length > 0
        ? {
            ...publico,
            warning:
              'El reembolso fue procesado, pero la orden no tiene una venta vinculada: no se generaron las devoluciones',
          }
        : publico;

    const handler = this.reembolsoRegistry.get();
    if (!handler) {
      this.logger.error(
        `Reembolso aprobado pero sin handler registrado (orden ${ctx.orden.ordenId})`,
      );
      return {
        ...publico,
        warning:
          'El reembolso fue procesado, pero no hay un módulo de ventas registrado para generar la nota de crédito',
      };
    }

    let correccionVentaId: string;
    try {
      ({ correccionVentaId } = await this.corregirReembolso(
        handler,
        ctx,
        ctx.orden.ventaId,
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `La corrección falló tras reembolso aprobado (orden ${ctx.orden.ordenId}, REFUND ${ctx.transaccionId}): ${msg}`,
      );
      // Al cliente (también el de la llave de API) solo llega un motivo de
      // negocio —un 400/422 que el servicio lanzó para ser leído—; el texto de un
      // error de base o de código es del log, no de la respuesta.
      return {
        ...publico,
        warning:
          e instanceof HttpException
            ? `El reembolso fue procesado, pero la nota de crédito/devolución falló: ${msg}`
            : 'El reembolso fue procesado, pero la nota de crédito/devolución falló por un error interno; el detalle quedó en el registro del servidor.',
      };
    }

    return { ...publico, notaCreditoId: correccionVentaId };
  }

  /**
   * La corrección de un REFUND aprobado: arma el evento —con cómo ligar el
   * REFUND dentro de la transacción de la nota— y se lo pasa a ventas. LANZA:
   * el hook post-commit lo envuelve en `aplicarPostReembolso` (un fallo ahí es
   * un `warning`, la plata ya volvió), y "Generar nota" deja subir el error
   * (ahí no hay nada consumado y el admin puede reintentar). Un solo camino.
   *
   * `extras` es solo de "Generar nota": la clave del intento y el chequeo bajo
   * el lock de la venta.
   */
  private corregirReembolso(
    handler: ReembolsoCallbackHandler,
    ctx: CtxHookReembolso,
    ventaId: string,
    extras: Pick<
      ReembolsoAprobadoEvento,
      'idempotencia' | 'alTomarLaVenta'
    > = {},
  ): Promise<{ correccionVentaId: string; repetida?: true }> {
    return handler.onReembolsoAprobado({
      tenantId: ctx.orden.tenantId,
      ordenId: ctx.orden.ordenId,
      codigoOrden: ctx.orden.codigoOrden,
      ventaId,
      monto: ctx.monto,
      devoluciones: ctx.devoluciones,
      usuarioId: ctx.usuarioId,
      ligarCorreccion: async (manager, id) => {
        const ligado = await this.transacciones.vincularCorreccion(
          ctx.orden.tenantId,
          ctx.transaccionId,
          id,
          manager,
        );
        // Sin fila que ligar la corrección no puede quedar: sería el estado
        // doble que esto cierra. Lanzar la revierte.
        if (!ligado)
          throw new Error(
            `La corrección ${id} no tocó ninguna fila al ligarse al REFUND ${ctx.transaccionId}`,
          );
      },
      ...extras,
    });
  }

  /**
   * "Generar nota" (owner, 2026-10-02): la corrección de un REFUND aprobado
   * cuya nota falló —la plata ya volvió por el proveedor y la boleta quedó sin
   * corregir—. Emite por el monto del REFUND con las líneas que confirma el
   * admin (la pantalla las precarga de lo que pidió el reembolso). **Nunca**
   * llama al proveedor. Mismo camino que el hook (`corregirReembolso`).
   *
   * Una nota por intento (ADR-026: el efecto está entero en la base): la clave
   * viaja en el evento y la nota la reclama como primera sentencia de su
   * transacción. Antes del reclamo solo se mira lo que nunca cambia para un
   * REFUND (que exista, que esté aprobado, que la orden tenga venta); lo que
   * cambia —que siga sin nota, y las líneas— va DESPUÉS, en `alTomarLaVenta`,
   * bajo el `FOR UPDATE` de la venta: chequearlo antes haría rebotar la
   * reproducción.
   *
   * ⚠️ Orden de locks: venta → fila del REFUND (la escribe `ligarCorreccion`),
   * el mismo del hook. La orden no se bloquea. Leer el vínculo bajo el lock de
   * la venta es confiable porque todo escritor del vínculo lo tiene.
   *
   * Los movimientos de stock son de quien hizo la declaración: quien pidió el
   * reembolso si lo confirmado es lo que pidió (ADR-029), si no quien hizo
   * clic. La fila de la nota no lleva usuario; quien hizo clic queda en el
   * reclamo de la clave.
   */
  async generarNotaDeReembolso(
    tenantId: string,
    ordenId: string,
    transaccionId: string,
    dto: GenerarNotaReembolsoDto,
    usuarioId: string,
    clave: string,
  ): Promise<Record<string, unknown>> {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    const refund = (
      await this.transacciones.listarPorOrden(tenantId, ordenId)
    ).find((t) => t.transaccionId === transaccionId && t.tipo === 'REFUND');
    if (!refund) throw new NotFoundException('Reembolso no encontrado');
    // Un sin confirmar se aclara en su tarjeta (Volver a consultar / Salió /
    // No salió) y deja su nota ahí: dos caminos para el mismo REFUND no.
    if (refund.estado !== 'aprobada')
      throw new BadRequestException(
        'Solo un reembolso aprobado lleva nota de crédito.',
      );
    const ventaId = orden.ventaId;
    if (!ventaId)
      throw new BadRequestException(
        'La orden no tiene una venta: no hay documento que corregir.',
      );
    const handler = this.reembolsoRegistry.get();
    if (!handler)
      throw new InternalServerErrorException(
        'No hay un módulo de ventas registrado para generar la nota de crédito',
      );

    const devoluciones = dto.devoluciones ?? [];
    const declaradas: unknown = refund.metadata?.devoluciones;
    // Con la normalización de la huella: el mismo pedido en otro orden o con
    // "2.00" por "2" sigue siendo lo que declaró quien pidió el reembolso.
    const esLaDeclarada =
      Array.isArray(declaradas) &&
      JSON.stringify(
        devolucionesNormalizadas(declaradas as DevolucionLineaDto[]),
      ) === JSON.stringify(devolucionesNormalizadas(devoluciones));
    const ctx: CtxHookReembolso = {
      ...this.ctxHookDe(orden, refund),
      devoluciones,
      usuarioId: esLaDeclarada ? refund.usuarioId : usuarioId,
    };

    const { correccionVentaId, repetida } = await this.corregirReembolso(
      handler,
      ctx,
      ventaId,
      {
        idempotencia: {
          tenantId,
          usuarioId,
          clave,
          operacion: 'pasarela.generarNota',
          huella: huellaDe('pasarela.generarNota', {
            ordenId,
            transaccionId,
            devoluciones: devolucionesNormalizadas(devoluciones),
          }),
          mensajeOtrosDatos: MENSAJE_NOTA_OTROS_DATOS,
        },
        alTomarLaVenta: async (manager) => {
          const actual = (
            await this.transacciones.listarPorOrden(tenantId, ordenId, manager)
          ).find((t) => t.transaccionId === transaccionId);
          // Otra clave —otra pestaña, otro admin— ya la generó. No se reproduce
          // como éxito: le diría a este admin que generó una nota que no generó.
          if (actual?.correccionVentaId)
            throw new ConflictException({
              statusCode: 409,
              message: MENSAJE_YA_TIENE_NOTA,
              notaCreditoId: actual.correccionVentaId,
            });
          // Las líneas, con la regla de la nota manual (tx0 del reembolso):
          // bajo el lock, así lo devuelto por otra nota desde el REFUND cuenta.
          if (devoluciones.length)
            await handler.validarDevoluciones(manager, {
              tenantId,
              ventaId,
              devoluciones,
            });
        },
      },
    );
    return {
      ...this.publicoDeReembolso(
        orden,
        await this.refundDeLaOrden(tenantId, ordenId, transaccionId),
      ),
      notaCreditoId: correccionVentaId,
      ...(repetida && { repetida: true }),
    };
  }

  /**
   * Reconcilia una orden no resuelta consultando el estado real al proveedor.
   * Acepta 'en_proceso' y 'expirada': la expiración perezosa es solo por reloj,
   * así que una orden que hizo timeout (y pudo haberse pagado en el proveedor)
   * debe seguir siendo verificable aunque el reloj ya la haya marcado expirada.
   */
  async verificar(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'en_proceso' && orden.estado !== 'expirada')
      throw new BadRequestException(
        `La orden ya está resuelta (${orden.estado})`,
      );

    // Resolver el proveedor de la orden (no la activa del tenant): por la
    // configuración con que se cobró, tomada de sus transacciones o metadata.
    const historial = await this.transacciones.listarPorOrden(
      tenantId,
      ordenId,
    );
    const tenantPasarelaId =
      historial.find((t) => t.tenantPasarelaId)?.tenantPasarelaId ??
      (typeof orden.metadata?.tenantPasarelaId === 'string'
        ? orden.metadata.tenantPasarelaId
        : null);
    if (!tenantPasarelaId)
      throw new BadRequestException(
        'No se puede determinar la pasarela de la orden para verificar',
      );

    const { pasarela, cred } =
      await this.tenantPasarelaService.resolverPorId(tenantPasarelaId);
    const consulta = await this.providerFactory
      .getReembolsable(pasarela.codigo)
      .consultarEstado(cred, {
        codigoOrden: orden.codigoOrden,
        tokenProveedor: orden.tokenProveedor,
      });

    if (consulta.estado !== 'desconocido') {
      orden.estado = consulta.estado;
      // Redactar la respuesta del proveedor antes de persistir (mismo invariante
      // que el historial de transacciones).
      orden.metadata = {
        ...orden.metadata,
        verificacion: this.transacciones.redactar(consulta.response),
      };
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden);
  }

  /**
   * `vistaAdmin`: lo que solo usa la pantalla del admin (el drawer de la
   * orden), que la ruta de la llave de API no expone. La respuesta de la API
   * externa es un contrato: un campo entra ahí por decisión propia, no de
   * arrastre de un cambio de pantalla (Sesión de esfuerzo máximo, 2026-10-06).
   */
  async obtenerOrden(
    tenantId: string,
    ordenId: string,
    { vistaAdmin = false }: { vistaAdmin?: boolean } = {},
  ) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    const transacciones = await this.transacciones.listarPorOrden(
      tenantId,
      ordenId,
    );
    // Expiración perezosa (sin job en v1), PERO nunca sobre una orden que sí
    // intentó autorizar (AUTHORIZATION 'error' por timeout): pudo haberse
    // pagado en el proveedor. Esas se cierran solo vía /verificar, no por reloj.
    const tuvoIntentoAuth = transacciones.some(
      (t) => t.tipo === 'AUTHORIZATION' && t.estado === 'error',
    );
    // Tampoco sobre una escrita antes de cobrar (el alta de suscripción,
    // ADR-029): pudo haberse cobrado aunque no haya dejado AUTHORIZATION.
    if (
      orden.estado === 'en_proceso' &&
      !tuvoIntentoAuth &&
      !orden.solicitudIdempotenteId &&
      orden.fechaExpiracion &&
      orden.fechaExpiracion < new Date()
    ) {
      orden.estado = 'expirada';
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden, {
      // Por qué la orden pagada no tiene venta: el aviso al admin. La API
      // externa no lo expone (contrato, ver arriba).
      ...(vistaAdmin && { motivoSinVenta: orden.motivoSinVenta }),
      transacciones: transacciones.map((t) => ({
        transaccionId: t.transaccionId,
        tipo: t.tipo,
        estado: t.estado,
        monto: t.monto,
        codigoAutorizacion: t.codigoAutorizacion,
        codigoRespuesta: t.codigoRespuesta,
        fechaTransaccion: t.fechaTransaccion,
        // La marca "sin nota de crédito" y lo que "Generar nota" precarga: lo
        // que pidió el reembolso (tx0, ADR-029), o `null` si no lo guardó.
        ...(vistaAdmin && {
          correccionVentaId: t.correccionVentaId,
          devoluciones:
            t.tipo === 'REFUND' && Array.isArray(t.metadata?.devoluciones)
              ? t.metadata.devoluciones
              : null,
        }),
      })),
    });
  }

  async listarOrdenes(
    tenantId: string,
    query: QueryOrdenesDto,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const dia = requiereDiaNegocio(query.fechaDesde, query.fechaHasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildListarOrdenesFilters(
      tenantId,
      query,
      dia,
    );

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM pasarela_ordenes o
       WHERE o.tenant_id = $1 AND o.eliminado_el IS NULL
       ${filters}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: OrdenListRow[] = await this.db.query(
      `SELECT o.orden_id, o.codigo_orden, o.pagador_ref, o.referencia_externa, o.venta_id,
              o.descripcion, o.monto, o.moneda, o.estado, o.origen,
              o.motivo_sin_venta, o.creado_el
       FROM pasarela_ordenes o
       WHERE o.tenant_id = $1 AND o.eliminado_el IS NULL
       ${filters}
       ORDER BY o.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapOrdenListRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildListarOrdenesFilters(
    tenantId: string,
    query: QueryOrdenesDto,
    dia: DiaNegocio | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    const idxDia = dia ? empujarDiaNegocio(params, dia) : null;

    if (query.estado) {
      params.push(query.estado);
      filters += ` AND o.estado = $${params.length}`;
    }
    if (query.origen) {
      params.push(query.origen);
      filters += ` AND o.origen = $${params.length}`;
    }
    // "Pagada sin venta": mismo criterio que `esPagadaSinVenta`. Una reembolsada
    // conserva el motivo pero ya no pide atención.
    if (query.sinVenta) {
      filters += ` AND o.estado = 'pagada' AND o.motivo_sin_venta IS NOT NULL`;
    }
    if (query.fechaDesde) {
      params.push(query.fechaDesde);
      filters += bordeFechaSql(
        'o.creado_el',
        '>=',
        query.fechaDesde,
        params.length,
        idxDia,
      );
    }
    if (query.fechaHasta) {
      params.push(query.fechaHasta);
      filters += bordeHastaSql(
        'o.creado_el',
        query.fechaHasta,
        params.length,
        idxDia,
      );
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      const idx = params.length;
      filters += ` AND (o.codigo_orden ILIKE $${idx} OR o.descripcion ILIKE $${idx} OR o.referencia_externa ILIKE $${idx} OR o.pagador_ref ILIKE $${idx})`;
    }

    return { filters, params };
  }

  private mapOrdenListRow(r: OrdenListRow): Record<string, unknown> {
    return {
      ordenId: r.orden_id,
      codigoOrden: r.codigo_orden,
      pagadorRef: r.pagador_ref,
      referenciaExterna: r.referencia_externa,
      ventaId: r.venta_id,
      descripcion: r.descripcion,
      monto: r.monto,
      moneda: r.moneda,
      estado: r.estado,
      origen: r.origen,
      motivoSinVenta: r.motivo_sin_venta,
      creadoEl: r.creado_el,
    };
  }
}
