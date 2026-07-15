import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';
import { ItemsService } from '../items/items.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { VentasService } from '../ventas/ventas.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { CobrosService } from '../pasarela/services/cobros.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { calcularProximoCobro } from './utils/proximo-cobro.util';

const PASARELA_TOKENIZADA = 'oneclick';

const TRANSICIONES: Record<string, { desde: string[]; hacia: string }> = {
  pausar: { desde: ['activa'], hacia: 'pausada' },
  reanudar: { desde: ['pausada'], hacia: 'activa' },
  cancelar: { desde: ['activa', 'pausada'], hacia: 'cancelada' },
};

@Injectable()
export class SuscripcionesService {
  private readonly logger = new Logger(SuscripcionesService.name);

  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepo: Repository<Suscripcion>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly itemsService: ItemsService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly ventasService: VentasService,
    private readonly metodosPagoService: MetodosPagoService,
    private readonly inscripcionesService: InscripcionesService,
    private readonly cobrosService: CobrosService,
    private readonly tenantPasarelaService: TenantPasarelaService,
  ) {}

  async crear(tenantId: string, usuarioId: string, dto: CreateSuscripcionDto) {
    // 1. Item suscribible del tenant
    const item = await this.itemsService.findOne(tenantId, dto.itemId);
    if (item.tipo !== 'suscripcion') {
      throw new BadRequestException('El item no es una suscripción');
    }
    if (!item.activo) {
      throw new BadRequestException('El item no está activo');
    }
    const frecuencia = item.frecuencia as string;

    // 2. Día según frecuencia (el rango grueso lo valida el DTO; aquí las reglas cruzadas)
    if (frecuencia === 'mensual' && dto.diaMes == null) {
      throw new BadRequestException(
        'Las suscripciones mensuales requieren el día del mes (1-28)',
      );
    }
    if (frecuencia === 'quincenal') {
      if (dto.diaMes == null || dto.diaMes > 13) {
        throw new BadRequestException(
          'Las suscripciones quincenales requieren un día del mes entre 1 y 13',
        );
      }
    }
    if (frecuencia === 'semanal' && dto.diaSemana == null) {
      throw new BadRequestException(
        'Las suscripciones semanales requieren el día de la semana',
      );
    }

    // 3. Oneclick debe estar activo en el tenant (decisión: sin Oneclick se bloquea)
    await this.assertOneclickActivo(tenantId);

    // 4. Ownership de la tarjeta + snapshot server-side (marca/últimos4)
    const { marca, ultimos4 } =
      await this.inscripcionesService.resolverMedioDeUsuario(
        tenantId,
        dto.inscripcionId,
        usuarioId,
      );

    // 5. Total del primer período (mismo motor que usará la venta)
    const resultado = await this.calculoPreciosService.calcular(tenantId, {
      lineas: [{ itemId: dto.itemId, cantidad: '1' }],
    });
    const totalFinal = resultado.totales.totalFinal;

    // 6. Método de pago contable (se registra en el pago de la venta)
    const metodoPagoId =
      await this.metodosPagoService.resolverMetodoCredito(tenantId);

    // 7. Cobro Oneclick real — FUERA de toda transacción DB (es una llamada HTTP
    //    al proveedor). Crea su propia pasarela_orden y autoriza contra Transbank.
    const orden = await this.cobrosService.cobrar(
      tenantId,
      {
        inscripcionId: dto.inscripcionId,
        pagadorRef: usuarioId,
        monto: totalFinal,
        descripcion: `Suscripción ${item.nombre}`,
      },
      'interno',
    );
    if (orden.estado !== 'pagada') {
      throw new BadRequestException(
        'El cobro de la suscripción fue rechazado. Probá con otra tarjeta.',
      );
    }
    const ordenId = orden.ordenId as string;

    // 8. Nombre del usuario para el customer de la venta
    const usuarioRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT nombre FROM usuarios WHERE usuario_id = $1 AND eliminado_el IS NULL`,
      [usuarioId],
    );
    const customerNombre = usuarioRows[0]?.nombre ?? 'Suscriptor online';

    // 9. Cobro OK → venta del primer período + suscripción, en UNA transacción.
    //    Si esto falla el cobro YA ocurrió: la orden queda 'pagada' sin venta
    //    (reconciliable, mismo invariante que el checkout Webpay); no revertimos
    //    el cobro automáticamente.
    let salida: {
      id: string;
      itemId: string;
      itemNombre: string;
      precio: string;
      monedaId: string | null;
      frecuencia: string;
      diaMes: number | null;
      diaSemana: number | null;
      estado: string;
      proximoCobro: string;
      activaHasta: string | null;
      inscripcionId: string | null;
      tarjetaMarca: string | null;
      tarjetaLast4: string | null;
      ventaInicialId: string;
      creadoEl: Date;
    };
    try {
      salida = await this.dataSource.transaction(async (manager) => {
        const venta = await this.ventasService.crearEnTransaccion(
          manager,
          tenantId,
          usuarioId,
          {
            canal: 'online',
            lineas: [{ itemId: dto.itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId, monto: totalFinal }],
            customer: { nombre: customerNombre },
          },
        );

        const suscripcion = await manager.save(
          Suscripcion,
          manager.create(Suscripcion, {
            tenantId,
            usuarioId,
            itemId: dto.itemId,
            frecuencia,
            diaMes: dto.diaMes ?? null,
            diaSemana: dto.diaSemana ?? null,
            estado: 'activa',
            proximoCobro: calcularProximoCobro(
              frecuencia,
              new Date(),
              dto.diaMes,
              dto.diaSemana,
            ),
            inscripcionId: dto.inscripcionId,
            tarjetaMarca: marca,
            tarjetaLast4: ultimos4,
            ventaInicialId: venta.id,
          }),
        );

        return {
          id: suscripcion.id,
          itemId: dto.itemId,
          itemNombre: item.nombre,
          precio: item.precioBase,
          monedaId: item.monedaId ?? null,
          frecuencia: suscripcion.frecuencia,
          diaMes: suscripcion.diaMes,
          diaSemana: suscripcion.diaSemana,
          estado: suscripcion.estado,
          proximoCobro: suscripcion.proximoCobro,
          activaHasta: suscripcion.activaHasta ?? null,
          inscripcionId: suscripcion.inscripcionId,
          tarjetaMarca: marca,
          tarjetaLast4: ultimos4,
          ventaInicialId: venta.id,
          creadoEl: suscripcion.creadoEl,
        };
      });
    } catch (e) {
      this.logger.error(
        `Cobro Oneclick aprobado (orden ${ordenId}) pero falló la creación de la venta/suscripción: la orden queda 'pagada' sin venta para reconciliación. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw e;
    }

    // 10. Conciliar la orden con la venta creada (best-effort: el alta ya está
    //     hecha; un fallo acá solo deja la orden 'pagada' en vez de 'conciliada').
    await this.cobrosService
      .vincularVenta(tenantId, ordenId, salida.ventaInicialId)
      .catch((e) =>
        this.logger.warn(
          `No se pudo conciliar la orden ${ordenId} con la venta ${salida.ventaInicialId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    return salida;
  }

  private async assertOneclickActivo(tenantId: string): Promise<void> {
    try {
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_TOKENIZADA,
      );
    } catch {
      throw new BadRequestException(
        'Las suscripciones requieren tener Oneclick activo en la pasarela del tenant',
      );
    }
  }

  async findMias(tenantId: string, usuarioId: string) {
    const rows: {
      suscripcion_id: string;
      item_id: string;
      item_nombre: string;
      precio_base: string;
      moneda_id: string;
      frecuencia: string;
      dia_mes: number | null;
      dia_semana: number | null;
      estado: string;
      proximo_cobro: string;
      activa_hasta: string | null;
      inscripcion_id: string | null;
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado,
              s.proximo_cobro::text AS proximo_cobro,
              s.activa_hasta::text AS activa_hasta,
              s.inscripcion_id, s.tarjeta_marca, s.tarjeta_last4,
              s.venta_inicial_id, s.creado_el
       FROM suscripciones s
       JOIN items i ON i.item_id = s.item_id AND i.eliminado_el IS NULL
       WHERE s.tenant_id = $1 AND s.usuario_id = $2 AND s.eliminado_el IS NULL
       ORDER BY s.creado_el DESC`,
      [tenantId, usuarioId],
    );

    return rows.map((r) => ({
      id: r.suscripcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      precio: r.precio_base,
      monedaId: r.moneda_id,
      frecuencia: r.frecuencia,
      diaMes: r.dia_mes,
      diaSemana: r.dia_semana,
      estado: r.estado,
      proximoCobro: r.proximo_cobro,
      activaHasta: r.activa_hasta,
      inscripcionId: r.inscripcion_id,
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  async findTodas(tenantId: string) {
    const rows: {
      suscripcion_id: string;
      item_id: string;
      item_nombre: string;
      precio_base: string;
      moneda_id: string;
      usuario_id: string;
      usuario_nombre: string;
      usuario_email: string;
      frecuencia: string;
      dia_mes: number | null;
      dia_semana: number | null;
      estado: string;
      proximo_cobro: string;
      activa_hasta: string | null;
      inscripcion_id: string | null;
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.usuario_id, u.nombre AS usuario_nombre, u.correo AS usuario_email,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado,
              s.proximo_cobro::text AS proximo_cobro,
              s.activa_hasta::text AS activa_hasta,
              s.inscripcion_id, s.tarjeta_marca, s.tarjeta_last4,
              s.venta_inicial_id, s.creado_el
       FROM suscripciones s
       JOIN items i ON i.item_id = s.item_id AND i.eliminado_el IS NULL
       JOIN usuarios u ON u.usuario_id = s.usuario_id AND u.eliminado_el IS NULL
       WHERE s.tenant_id = $1 AND s.eliminado_el IS NULL
       ORDER BY s.creado_el DESC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.suscripcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      precio: r.precio_base,
      monedaId: r.moneda_id,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      usuarioEmail: r.usuario_email,
      frecuencia: r.frecuencia,
      diaMes: r.dia_mes,
      diaSemana: r.dia_semana,
      estado: r.estado,
      proximoCobro: r.proximo_cobro,
      activaHasta: r.activa_hasta,
      inscripcionId: r.inscripcion_id,
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  // usuarioId = null ⇒ scope admin: opera sobre cualquier suscripción del tenant.
  async cambiarEstado(
    tenantId: string,
    usuarioId: string | null,
    suscripcionId: string,
    dto: UpdateSuscripcionDto,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where:
        usuarioId === null
          ? { id: suscripcionId, tenantId }
          : { id: suscripcionId, tenantId, usuarioId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }

    const transicion = TRANSICIONES[dto.accion];
    if (!transicion.desde.includes(suscripcion.estado)) {
      throw new BadRequestException(
        `No se puede ${dto.accion} una suscripción ${suscripcion.estado}`,
      );
    }

    suscripcion.estado = transicion.hacia;
    if (dto.accion === 'cancelar') {
      // El período ya cobrado sigue vigente: usable hasta el día anterior a
      // activa_hasta, "se cancela ese día a primera hora".
      suscripcion.activaHasta = suscripcion.proximoCobro;
    }
    await this.suscripcionRepo.save(suscripcion);
    return {
      id: suscripcion.id,
      estado: suscripcion.estado,
      activaHasta: suscripcion.activaHasta,
    };
  }

  /**
   * Reasigna la tarjeta (inscripción Oneclick) de una suscripción propia del
   * usuario. Solo activa/pausada; valida ownership de la suscripción y de la
   * inscripción, y actualiza el snapshot de tarjeta.
   */
  async cambiarTarjeta(
    tenantId: string,
    usuarioId: string,
    suscripcionId: string,
    inscripcionId: string,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId, usuarioId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (!['activa', 'pausada'].includes(suscripcion.estado)) {
      throw new BadRequestException(
        `No se puede cambiar la tarjeta de una suscripción ${suscripcion.estado}`,
      );
    }

    const { marca, ultimos4 } =
      await this.inscripcionesService.resolverMedioDeUsuario(
        tenantId,
        inscripcionId,
        usuarioId,
      );

    suscripcion.inscripcionId = inscripcionId;
    suscripcion.tarjetaMarca = marca;
    suscripcion.tarjetaLast4 = ultimos4;
    await this.suscripcionRepo.save(suscripcion);
    return {
      id: suscripcion.id,
      inscripcionId,
      tarjetaMarca: marca,
      tarjetaLast4: ultimos4,
    };
  }

  /**
   * Cuenta las suscripciones vigentes (activa/pausada) amarradas a cada
   * inscripción de un usuario. Alimenta el aviso del modal de borrado de tarjeta.
   */
  async contarPorInscripcion(
    tenantId: string,
    usuarioId: string,
  ): Promise<Record<string, number>> {
    const rows: { inscripcion_id: string; total: number }[] =
      await this.dataSource.query(
        `SELECT inscripcion_id, COUNT(*)::int AS total
         FROM suscripciones
         WHERE tenant_id = $1 AND usuario_id = $2 AND eliminado_el IS NULL
           AND inscripcion_id IS NOT NULL
           AND estado IN ('activa', 'pausada')
         GROUP BY inscripcion_id`,
        [tenantId, usuarioId],
      );
    return Object.fromEntries(rows.map((r) => [r.inscripcion_id, r.total]));
  }

  /**
   * Cancela todas las suscripciones vigentes (activa/pausada) de un usuario
   * amarradas a una inscripción. Se invoca al eliminar la tarjeta: usa la misma
   * semántica que `cancelar` (activa_hasta = proximo_cobro).
   */
  async cancelarPorInscripcion(
    tenantId: string,
    usuarioId: string,
    inscripcionId: string,
  ): Promise<{ canceladas: number }> {
    const suscripciones = await this.suscripcionRepo.find({
      where: [
        { tenantId, usuarioId, inscripcionId, estado: 'activa' },
        { tenantId, usuarioId, inscripcionId, estado: 'pausada' },
      ],
    });
    for (const s of suscripciones) {
      s.estado = 'cancelada';
      s.activaHasta = s.proximoCobro;
    }
    if (suscripciones.length) {
      await this.suscripcionRepo.save(suscripciones);
    }
    return { canceladas: suscripciones.length };
  }

  async eliminar(tenantId: string, suscripcionId: string) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (suscripcion.estado !== 'cancelada') {
      throw new BadRequestException(
        'Solo se pueden eliminar suscripciones canceladas',
      );
    }
    await this.suscripcionRepo.softRemove(suscripcion);
    return { id: suscripcion.id };
  }
}
