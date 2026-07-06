import {
  BadRequestException,
  Injectable,
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
import { calcularProximoCobro } from './utils/proximo-cobro.util';

const TRANSICIONES: Record<string, { desde: string[]; hacia: string }> = {
  pausar: { desde: ['activa'], hacia: 'pausada' },
  reanudar: { desde: ['pausada'], hacia: 'activa' },
  cancelar: { desde: ['activa', 'pausada'], hacia: 'cancelada' },
};

@Injectable()
export class SuscripcionesService {
  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepo: Repository<Suscripcion>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly itemsService: ItemsService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly ventasService: VentasService,
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

    // 3. Total del primer período (mismo motor que usará la venta)
    const resultado = await this.calculoPreciosService.calcular(tenantId, {
      lineas: [{ itemId: dto.itemId, cantidad: '1' }],
    });

    // 4. Nombre del usuario para el customer de la venta
    const usuarioRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT nombre FROM usuarios WHERE usuario_id = $1 AND eliminado_el IS NULL`,
      [usuarioId],
    );
    const customerNombre = usuarioRows[0]?.nombre ?? 'Suscriptor online';

    // 5. Venta del primer cobro + suscripción, en UNA transacción
    return this.dataSource.transaction(async (manager) => {
      const venta = await this.ventasService.crearEnTransaccion(
        manager,
        tenantId,
        usuarioId,
        {
          canal: 'online',
          lineas: [{ itemId: dto.itemId, cantidad: '1' }],
          pagos: [
            {
              metodoPagoId: dto.metodoPagoId,
              monto: resultado.totales.totalFinal,
            },
          ],
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
          tarjetaMarca: dto.tarjeta?.marca ?? null,
          tarjetaLast4: dto.tarjeta?.last4 ?? null,
          ventaInicialId: venta.id,
        }),
      );

      return {
        id: suscripcion.id,
        ventaInicialId: venta.id,
        proximoCobro: suscripcion.proximoCobro,
        estado: suscripcion.estado,
      };
    });
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
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado, s.proximo_cobro,
              s.tarjeta_marca, s.tarjeta_last4, s.venta_inicial_id, s.creado_el
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
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  async cambiarEstado(
    tenantId: string,
    usuarioId: string,
    suscripcionId: string,
    dto: UpdateSuscripcionDto,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId, usuarioId },
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
    await this.suscripcionRepo.save(suscripcion);
    return { id: suscripcion.id, estado: suscripcion.estado };
  }
}
