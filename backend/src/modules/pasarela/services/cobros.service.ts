import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { randomBytes } from 'crypto';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { CreateCobroDto } from '../dto/create-cobro.dto';
import { CreateReembolsoDto } from '../dto/create-reembolso.dto';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import {
  ProviderComunicacionError,
  ResultadoCobro,
} from '../providers/payment-provider.interface';

const PASARELA_V1 = 'oneclick';
const EXPIRACION_ORDEN_MS = 2 * 60 * 60 * 1000; // 2 horas

/** Datos mínimos para auditar un reembolso con timeout fuera de la transacción. */
interface CtxAuditoriaReembolso {
  tenantPasarelaId: string;
  inscripcionId: string | null;
  transaccionPadreId: string;
  moneda: string;
  codigoOrden: string;
}

@Injectable()
export class CobrosService {
  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly inscripciones: InscripcionesService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly credenciales: CredencialesService,
    private readonly providerFactory: ProviderFactory,
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
        moneda: 'CLP',
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
        moneda: 'CLP',
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
          moneda: 'CLP',
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
      moneda: 'CLP',
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

  async reembolsar(tenantId: string, ordenId: string, dto: CreateReembolsoDto) {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    // Todo el read (disponible) → proveedor → write corre bajo un lock pesimista
    // de la fila de la orden (SELECT ... FOR UPDATE): dos reembolsos concurrentes
    // sobre la misma orden se serializan y no pueden exceder el total juntos.
    // Trade-off consciente: el lock se sostiene durante la llamada HTTP al
    // proveedor; aceptable porque los reembolsos son de baja frecuencia.
    //
    // Contexto capturado dentro de la tx para poder auditar un timeout DESPUÉS
    // de que la tx haga rollback y libere el lock (ver el catch de más abajo).
    // Sin inicializador: TS conserva el tipo declarado para vars asignadas en
    // un closure (con `= null` lo estrecharía a `null` en el catch).
    let ctxTimeout: CtxAuditoriaReembolso | undefined;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const orden = await manager.findOne(PasarelaOrden, {
          where: { ordenId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!orden) throw new NotFoundException('Orden no encontrada');
        if (orden.estado !== 'pagada' && orden.estado !== 'reembolsada')
          throw new BadRequestException(
            `No se puede reembolsar una orden ${orden.estado}`,
          );

        // Leído tras adquirir el lock: ve los REFUND ya commiteados por un
        // reembolso concurrente previo (READ COMMITTED).
        const historial = await this.transacciones.listarPorOrden(
          tenantId,
          ordenId,
          manager,
        );
        const autorizacion = historial.find(
          (t) => t.tipo === 'AUTHORIZATION' && t.estado === 'aprobada',
        );
        if (!autorizacion)
          throw new BadRequestException(
            'La orden no tiene una autorización aprobada',
          );

        const yaReembolsado = historial
          .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
          .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
        const disponible = new Decimal(orden.monto).minus(yaReembolsado);
        if (new Decimal(dto.monto).gt(disponible))
          throw new BadRequestException(
            `El monto excede lo disponible para reembolso (${disponible.toString()})`,
          );

        // Resolver el proveedor de la orden por la configuración con que se cobró
        // (la AUTHORIZATION original), no por la activa del tenant: reembolsa bajo
        // la misma pasarela aunque el tenant haya cambiado de activa. Sirve para
        // cualquier flujo (Oneclick o Webpay Plus) vía la interfaz común.
        const { pasarela, cred } =
          await this.tenantPasarelaService.resolverPorId(
            autorizacion.tenantPasarelaId,
          );

        // Guardar el contexto de auditoría ANTES de llamar al proveedor, por si
        // hace timeout: el rastro se registra fuera de la tx (catch de abajo).
        ctxTimeout = {
          tenantPasarelaId: autorizacion.tenantPasarelaId,
          inscripcionId: autorizacion.inscripcionId,
          transaccionPadreId: autorizacion.transaccionId,
          moneda: orden.moneda,
          codigoOrden: orden.codigoOrden,
        };

        // Un ProviderComunicacionError se propaga fuera de la transacción: NO se
        // audita aquí dentro. Registrar en pasarela_transacciones toma FOR KEY
        // SHARE sobre la fila de la orden, que conflictúa con el FOR UPDATE que
        // esta misma tx ya sostiene → auto-bloqueo (el detector de deadlock de PG
        // no lo ve porque esperamos en Node). El rollback libera el lock primero;
        // el rastro se escribe recién entonces, en una conexión normal.
        const resultado = await this.providerFactory
          .getReembolsable(pasarela.codigo)
          .reembolsar(cred, {
            codigoOrden: orden.codigoOrden,
            monto: dto.monto,
            tokenProveedor: orden.tokenProveedor,
          });

        await this.transacciones.registrar(
          {
            tenantId,
            ordenId,
            tenantPasarelaId: autorizacion.tenantPasarelaId,
            inscripcionId: autorizacion.inscripcionId,
            transaccionPadreId: autorizacion.transaccionId,
            tipo: 'REFUND',
            estado: resultado.aprobada ? 'aprobada' : 'rechazada',
            monto: dto.monto,
            moneda: orden.moneda,
            codigoOrden: orden.codigoOrden,
            codigoRespuesta: resultado.codigoRespuesta,
            tipoPago: resultado.tipoPago,
            request: resultado.request,
            response: resultado.response,
          },
          manager,
        );

        if (
          resultado.aprobada &&
          yaReembolsado.plus(dto.monto).gte(orden.monto)
        ) {
          orden.estado = 'reembolsada';
          await manager.save(orden);
        }
        return this.toPublico(orden, {
          reembolsoAprobado: resultado.aprobada,
        });
      });
    } catch (e) {
      if (e instanceof ProviderComunicacionError && ctxTimeout) {
        // La tx ya hizo rollback y liberó el FOR UPDATE: ahora sí registramos el
        // rastro del intento en una conexión normal, sin auto-bloqueo. Mismo
        // invariante que cobrar(): un timeout no es rechazo → 502, orden intacta.
        await this.transacciones.registrar({
          tenantId,
          ordenId,
          tenantPasarelaId: ctxTimeout.tenantPasarelaId,
          inscripcionId: ctxTimeout.inscripcionId,
          transaccionPadreId: ctxTimeout.transaccionPadreId,
          tipo: 'REFUND',
          estado: 'error',
          monto: dto.monto,
          moneda: ctxTimeout.moneda,
          codigoOrden: ctxTimeout.codigoOrden,
          request: e.request,
          response: e.response,
        });
        throw new BadGatewayException(
          `No se pudo confirmar el reembolso (orden ${ordenId}); verifique el estado con POST /pasarela/api/ordenes/${ordenId}/verificar`,
        );
      }
      throw e;
    }
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

  async obtenerOrden(tenantId: string, ordenId: string) {
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
    if (
      orden.estado === 'en_proceso' &&
      !tuvoIntentoAuth &&
      orden.fechaExpiracion &&
      orden.fechaExpiracion < new Date()
    ) {
      orden.estado = 'expirada';
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden, {
      transacciones: transacciones.map((t) => ({
        transaccionId: t.transaccionId,
        tipo: t.tipo,
        estado: t.estado,
        monto: t.monto,
        codigoAutorizacion: t.codigoAutorizacion,
        codigoRespuesta: t.codigoRespuesta,
        fechaTransaccion: t.fechaTransaccion,
      })),
    });
  }

  async listarOrdenes(tenantId: string, page = 1, pageSize = 15) {
    const [data, total] = await this.ordenRepo.findAndCount({
      where: { tenantId },
      order: { creadoEl: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      data: data.map((o) => this.toPublico(o, { origen: o.origen })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }
}
