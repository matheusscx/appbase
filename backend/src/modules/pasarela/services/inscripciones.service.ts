import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PasarelaInscripcion } from '../entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from '../entities/pasarela-medio-pago.entity';
import { CreateInscripcionDto } from '../dto/create-inscripcion.dto';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';

const PASARELA_V1 = 'oneclick'; // v1: única pasarela con tokenización

@Injectable()
export class InscripcionesService {
  private readonly logger = new Logger(InscripcionesService.name);

  constructor(
    @InjectRepository(PasarelaInscripcion)
    private readonly inscripcionRepo: Repository<PasarelaInscripcion>,
    @InjectRepository(PasarelaMedioPago)
    private readonly medioRepo: Repository<PasarelaMedioPago>,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly credenciales: CredencialesService,
    private readonly providerFactory: ProviderFactory,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private toPublico(i: PasarelaInscripcion, medios: PasarelaMedioPago[] = []) {
    // Nunca exponer identificadorExterno (tbkUser) ni tokenProveedor
    return {
      inscripcionId: i.inscripcionId,
      pagadorRef: i.pagadorRef,
      estado: i.estado,
      preferida: i.preferida,
      creadoEl: i.creadoEl,
      mediosPago: medios.map((m) => ({
        medioPagoId: m.medioPagoId,
        tipo: m.tipo,
        marca: m.marca,
        ultimos4: m.ultimos4,
        estado: m.estado,
      })),
    };
  }

  async iniciar(tenantId: string, dto: CreateInscripcionDto) {
    const { tenantPasarela, pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_V1,
      );

    // username propio (formato del proveedor, sin filtrar identificadores del tenant)
    const username = `insc-${randomUUID().replace(/-/g, '')}`;
    const responseUrl = `${this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000'}/api/pasarela/retorno/inscripcion`;

    const provider = this.providerFactory.getTokenizado(pasarela.codigo);
    const inicio = await provider.iniciarInscripcion(cred, {
      username,
      email: dto.email,
      responseUrl,
    });

    const inscripcion = await this.inscripcionRepo.save(
      this.inscripcionRepo.create({
        tenantId,
        tenantPasarelaId: tenantPasarela.tenantPasarelaId,
        pagadorRef: dto.pagadorRef,
        identificadorUsuarioExterno: username,
        estado: 'pendiente',
        tokenProveedor: inicio.tokenExterno,
        urlRetornoApp: dto.urlRetorno,
      }),
    );

    return {
      inscripcionId: inscripcion.inscripcionId,
      urlWebpay: inicio.urlRedireccion,
      token: inicio.tokenExterno,
    };
  }

  /** Retorno de Webpay: confirma contra el proveedor y redirige a la app. */
  async confirmarRetorno(
    tbkToken: string,
  ): Promise<{ urlRedireccion: string }> {
    // Claim atómico: solo una request pasa 'pendiente' → 'procesando'. Cierra la
    // ventana de doble retorno de Webpay (reintento/doble POST) que, sin esto,
    // duplicaría medio de pago y transacción para la misma inscripción.
    const claim = await this.inscripcionRepo.update(
      { tokenProveedor: tbkToken, estado: 'pendiente' },
      { estado: 'procesando' },
    );
    if (!claim.affected)
      throw new NotFoundException('Inscripción no encontrada para el token');

    const inscripcion = await this.inscripcionRepo.findOne({
      where: { tokenProveedor: tbkToken },
    });
    if (!inscripcion)
      throw new NotFoundException('Inscripción no encontrada para el token');

    let medioPagoId: string | null = null;
    try {
      const tp = await this.tenantPasarelaService.resolverConfiguracionActiva(
        inscripcion.tenantId,
        PASARELA_V1,
      );
      const provider = this.providerFactory.getTokenizado(tp.pasarela.codigo);
      const resultado = await provider.confirmarInscripcion(tp.cred, tbkToken);

      inscripcion.estado = resultado.aprobada ? 'activa' : 'fallida';
      inscripcion.identificadorExterno = resultado.identificadorExterno
        ? this.credenciales.cifrarTexto(resultado.identificadorExterno)
        : null;
      inscripcion.tokenProveedor = null; // token de un solo uso
      await this.inscripcionRepo.save(inscripcion);

      if (resultado.aprobada && resultado.tarjeta) {
        const medio = await this.medioRepo.save(
          this.medioRepo.create({
            inscripcionId: inscripcion.inscripcionId,
            tipo: resultado.tarjeta.tipo,
            marca: resultado.tarjeta.marca,
            ultimos4: resultado.tarjeta.ultimos4,
            estado: 'activo',
          }),
        );
        medioPagoId = medio.medioPagoId;
      }

      await this.transacciones.registrar({
        tenantId: inscripcion.tenantId,
        tenantPasarelaId: inscripcion.tenantPasarelaId,
        inscripcionId: inscripcion.inscripcionId,
        medioPagoId,
        tipo: 'INSCRIPTION',
        estado: resultado.aprobada ? 'aprobada' : 'rechazada',
        codigoRespuesta: resultado.codigoRespuesta,
        codigoAutorizacion: resultado.codigoAutorizacion,
        request: resultado.request,
        response: resultado.response,
      });
    } catch (e) {
      // Compensación: si algo falla tras el claim, devolver la inscripción a
      // 'pendiente' para no dejarla trabada en 'procesando' — un reintento
      // legítimo de Webpay podrá reprocesarla. Best-effort, no enmascara el error.
      await this.inscripcionRepo
        .update(
          { inscripcionId: inscripcion.inscripcionId, estado: 'procesando' },
          { estado: 'pendiente' },
        )
        .catch((err) =>
          // Si hasta la compensación falla, la fila queda trabada en 'procesando':
          // dejar rastro para reconciliación manual.
          this.logger.warn(
            `No se pudo revertir la inscripción ${inscripcion.inscripcionId} a 'pendiente': ${String(err)}`,
          ),
        );
      throw e;
    }

    const sep = inscripcion.urlRetornoApp.includes('?') ? '&' : '?';
    return {
      urlRedireccion: `${inscripcion.urlRetornoApp}${sep}inscripcionId=${inscripcion.inscripcionId}&estado=${inscripcion.estado}`,
    };
  }

  async obtener(tenantId: string, inscripcionId: string) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: { inscripcionId, tenantId },
    });
    if (!inscripcion) throw new NotFoundException('Inscripción no encontrada');
    const medios = await this.medioRepo.find({ where: { inscripcionId } });
    return this.toPublico(inscripcion, medios);
  }

  async listarPorPagador(tenantId: string, pagadorRef: string) {
    const lista = await this.inscripcionRepo.find({
      where: { tenantId, pagadorRef },
      order: { creadoEl: 'DESC' },
    });
    return Promise.all(
      lista.map(async (i) =>
        this.toPublico(
          i,
          await this.medioRepo.find({
            where: { inscripcionId: i.inscripcionId },
          }),
        ),
      ),
    );
  }

  async eliminar(tenantId: string, inscripcionId: string, pagadorRef?: string) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: {
        inscripcionId,
        tenantId,
        estado: 'activa',
        ...(pagadorRef ? { pagadorRef } : {}),
      },
    });
    if (!inscripcion)
      throw new NotFoundException('Inscripción activa no encontrada');
    if (!inscripcion.identificadorExterno)
      throw new BadRequestException(
        'La inscripción no tiene identificador del proveedor',
      );

    const tp = await this.tenantPasarelaService.resolverConfiguracionActiva(
      tenantId,
      PASARELA_V1,
    );
    const provider = this.providerFactory.getTokenizado(tp.pasarela.codigo);
    await provider.eliminarInscripcion(tp.cred, {
      identificadorExterno: this.credenciales.descifrarTexto(
        inscripcion.identificadorExterno,
      ),
      username: inscripcion.identificadorUsuarioExterno,
    });

    // softRemove solo escribe eliminado_el; el save() persiste estado='eliminada'.
    inscripcion.estado = 'eliminada';
    await this.inscripcionRepo.save(inscripcion);
    await this.medioRepo.update({ inscripcionId }, { estado: 'eliminado' });
    await this.inscripcionRepo.softRemove(inscripcion);
    return { inscripcionId };
  }

  /** Marca la inscripción como preferida del pagador (desmarca las demás). */
  async marcarPreferida(
    tenantId: string,
    inscripcionId: string,
    pagadorRef?: string,
  ) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: {
        inscripcionId,
        tenantId,
        estado: 'activa',
        ...(pagadorRef ? { pagadorRef } : {}),
      },
    });
    if (!inscripcion)
      throw new NotFoundException('Inscripción activa no encontrada');

    // Regla "solo una": limpiar el flag del pagador y marcar la nueva, atómico.
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        PasarelaInscripcion,
        { tenantId, pagadorRef: inscripcion.pagadorRef, preferida: true },
        { preferida: false },
      );
      await manager.update(
        PasarelaInscripcion,
        { inscripcionId: inscripcion.inscripcionId },
        { preferida: true },
      );
    });

    inscripcion.preferida = true;
    const medios = await this.medioRepo.find({
      where: { inscripcionId: inscripcion.inscripcionId },
    });
    return this.toPublico(inscripcion, medios);
  }

  /** Inscripción activa para cobrar: por id explícito o la más reciente del pagador. */
  async resolverParaCobro(
    tenantId: string,
    inscripcionId?: string,
    pagadorRef?: string,
  ) {
    if (!inscripcionId && !pagadorRef)
      throw new BadRequestException('Debe indicar inscripcionId o pagadorRef');
    // Con inscripcionId y pagadorRef juntos se enforce ownership (el flujo
    // interno de suscripciones pasa ambos): un usuario no puede cobrar la
    // inscripción de otro del mismo tenant. La API m2m pasa solo uno.
    const inscripcion = await this.inscripcionRepo.findOne({
      where: inscripcionId
        ? {
            inscripcionId,
            tenantId,
            estado: 'activa',
            ...(pagadorRef ? { pagadorRef } : {}),
          }
        : { tenantId, pagadorRef, estado: 'activa' },
      order: { preferida: 'DESC', creadoEl: 'DESC' },
    });
    if (!inscripcion)
      throw new BadRequestException(
        'El pagador no tiene una inscripción activa',
      );
    return inscripcion;
  }

  /**
   * Inscripción activa de un pagador con el snapshot de su tarjeta (marca,
   * últimos4). Valida ownership (tenantId + pagadorRef) — pensado para los
   * flujos internos de la tienda (suscripciones) donde el inscripcionId lo
   * elige el usuario final.
   */
  async resolverMedioDeUsuario(
    tenantId: string,
    inscripcionId: string,
    pagadorRef: string,
  ): Promise<{
    inscripcion: PasarelaInscripcion;
    marca: string | null;
    ultimos4: string | null;
  }> {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: { inscripcionId, tenantId, pagadorRef, estado: 'activa' },
    });
    if (!inscripcion)
      throw new NotFoundException('Inscripción activa no encontrada');
    const medio = await this.medioRepo.findOne({
      where: { inscripcionId, estado: 'activo' },
    });
    return {
      inscripcion,
      marca: medio?.marca ?? null,
      ultimos4: medio?.ultimos4 ?? null,
    };
  }
}
