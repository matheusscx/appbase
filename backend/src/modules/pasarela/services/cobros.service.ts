import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class CobrosService {
  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
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
    const provider = this.providerFactory.get(pasarela.codigo);

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
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'pagada' && orden.estado !== 'reembolsada')
      throw new BadRequestException(
        `No se puede reembolsar una orden ${orden.estado}`,
      );

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

    const yaReembolsado = historial
      .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
      .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
    const disponible = new Decimal(orden.monto).minus(yaReembolsado);
    if (new Decimal(dto.monto).gt(disponible))
      throw new BadRequestException(
        `El monto excede lo disponible para reembolso (${disponible.toString()})`,
      );

    const { pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_V1,
      );
    const resultado = await this.providerFactory
      .get(pasarela.codigo)
      .reembolsar(cred, { codigoOrden: orden.codigoOrden, monto: dto.monto });

    await this.transacciones.registrar({
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
    });

    if (resultado.aprobada && yaReembolsado.plus(dto.monto).gte(orden.monto)) {
      orden.estado = 'reembolsada';
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden, { reembolsoAprobado: resultado.aprobada });
  }

  /** Cierra una orden en_proceso consultando el estado real al proveedor. */
  async verificar(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'en_proceso')
      throw new BadRequestException(
        `La orden ya está resuelta (${orden.estado})`,
      );

    const { pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_V1,
      );
    const consulta = await this.providerFactory
      .get(pasarela.codigo)
      .consultarEstado(cred, orden.codigoOrden);

    if (consulta.estado !== 'desconocido') {
      orden.estado = consulta.estado;
      orden.metadata = { ...orden.metadata, verificacion: consulta.response };
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden);
  }

  async obtenerOrden(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({
      where: { ordenId, tenantId },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    // Expiración perezosa: sin job en v1
    if (
      orden.estado === 'en_proceso' &&
      orden.fechaExpiracion &&
      orden.fechaExpiracion < new Date()
    ) {
      orden.estado = 'expirada';
      await this.ordenRepo.save(orden);
    }
    const transacciones = await this.transacciones.listarPorOrden(
      tenantId,
      ordenId,
    );
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
