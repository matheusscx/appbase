import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateDescuentoDto } from './dto/create-descuento.dto';
import { UpdateDescuentoDto } from './dto/update-descuento.dto';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const CLASE = 'descuento';

@Injectable()
export class DescuentosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Descuento)
    private readonly descuentoRepo: Repository<Descuento>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(DescuentoTramo)
    private readonly tramoRepo: Repository<DescuentoTramo>,
    @InjectRepository(DescuentoMetodoPago)
    private readonly metodoPagoRepo: Repository<DescuentoMetodoPago>,
  ) {}

  async findAll(tenantId: string) {
    const reglas = await this.descuentoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
    const ids = reglas.map((r) => r.id);

    const tramos = ids.length
      ? await this.tramoRepo.find({
          where: { descuentoId: In(ids) },
          order: { orden: 'ASC' },
        })
      : [];

    const metodos = ids.length
      ? await this.metodoPagoRepo.find({
          where: { descuentoId: In(ids) },
        })
      : [];

    const tipoIds = [...new Set(reglas.map((r) => r.tipoReglaId))];
    const tipos = tipoIds.length
      ? await this.tipoReglaRepo.find({ where: { id: In(tipoIds) } })
      : [];
    const tipoMap = new Map(tipos.map((t) => [t.id, t]));

    return reglas.map((r) => ({
      ...r,
      tipoRegla: tipoMap.get(r.tipoReglaId) ?? null,
      tramos: tramos
        .filter((t) => t.descuentoId === r.id)
        .map((t) => ({ minimo: t.minimo, valor: t.valor })),
      metodoPagoIds: metodos
        .filter((m) => m.descuentoId === r.id)
        .map((m) => m.metodoPagoId),
      diasVencimiento: r.condicionValor ? parseInt(r.condicionValor, 10) : null,
    }));
  }

  async create(tenantId: string, dto: CreateDescuentoDto) {
    const tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    await this.validarNombreUnico(tenantId, dto.nombre);
    this.validarSegunTipo(tipoRegla.codigo, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const condicionValor =
        dto.diasVencimiento != null ? String(dto.diasVencimiento) : null;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : (dto.modo as ModoRegla);

      const descuento = manager.create(Descuento, {
        tenantId,
        nombre: dto.nombre,
        tipoReglaId: dto.tipoReglaId,
        modo,
        valor: dto.valor ?? null,
        condicionTipo,
        condicionValor,
        fechaInicio: dto.fechaInicio ?? null,
        fechaFin: dto.fechaFin ?? null,
        activo: dto.activo ?? true,
      });
      await manager.save(descuento);

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(DescuentoTramo, {
            descuentoId: descuento.id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(DescuentoMetodoPago, {
            descuentoId: descuento.id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return descuento;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDescuentoDto) {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);

    let tipoRegla: TipoRegla;
    if (dto.tipoReglaId) {
      tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    } else {
      const tipo = await this.tipoReglaRepo.findOne({
        where: { id: descuento.tipoReglaId },
      });
      if (!tipo)
        throw new BadRequestException(
          'El tipo de regla seleccionado no existe',
        );
      tipoRegla = tipo;
    }

    await this.validarNombreUnico(tenantId, dto.nombre ?? descuento.nombre, id);
    this.validarSegunTipo(tipoRegla.codigo, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const condicionValor =
        dto.diasVencimiento != null
          ? String(dto.diasVencimiento)
          : descuento.condicionValor;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : ((dto.modo as ModoRegla) ?? descuento.modo);

      Object.assign(descuento, {
        ...dto,
        modo,
        condicionTipo,
        condicionValor,
      });
      await manager.save(descuento);

      // Replace all children
      await manager.delete(DescuentoTramo, { descuentoId: id });
      await manager.delete(DescuentoMetodoPago, { descuentoId: id });

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(DescuentoTramo, {
            descuentoId: id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(DescuentoMetodoPago, {
            descuentoId: id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return descuento;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);
    await this.descuentoRepo.softDelete({ id, tenantId });
  }

  async nombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<{ disponible: boolean }> {
    const qb = this.descuentoRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('d.nombre = :nombre', { nombre })
      .andWhere('d.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('d.descuento_id != :excludeId', { excludeId });
    }
    const count = await qb.getCount();
    return { disponible: count === 0 };
  }

  private async validarTipoRegla(tipoReglaId: string): Promise<TipoRegla> {
    const tipo = await this.tipoReglaRepo.findOne({
      where: { id: tipoReglaId },
    });
    if (!tipo)
      throw new BadRequestException('El tipo de regla seleccionado no existe');
    if (tipo.clase !== CLASE)
      throw new BadRequestException(
        'El tipo seleccionado no corresponde a un descuento',
      );
    return tipo;
  }

  private async validarNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const { disponible } = await this.nombreDisponible(
      tenantId,
      nombre,
      excludeId,
    );
    if (!disponible)
      throw new BadRequestException(
        `Ya existe un descuento con el nombre "${nombre}"`,
      );
  }

  private validarSegunTipo(
    codigo: string,
    dto: CreateDescuentoDto | UpdateDescuentoDto,
  ): void {
    const tiposConTramos = ['por_mayor', 'por_monto_venta'];
    const tiposConMetodos = ['metodo_pago', 'recargo_metodo_pago'];
    const tiposFijoPorcentaje = [
      'pronto_pago',
      'interes_simple',
      'interes_compuesto',
    ];
    const tiposConValorUnico = [
      'metodo_pago',
      'pronto_pago',
      'promocional',
      'general',
      'mora',
      'recargo_metodo_pago',
      'interes_simple',
      'interes_compuesto',
    ];

    if (tiposConTramos.includes(codigo)) {
      if (!dto.tramos?.length)
        throw new BadRequestException('Este tipo requiere al menos un tramo');
    }

    if (tiposConMetodos.includes(codigo)) {
      if (!dto.metodoPagoIds?.length)
        throw new BadRequestException('Selecciona al menos un método de pago');
    }

    if (
      tiposFijoPorcentaje.includes(codigo) &&
      dto.modo &&
      dto.modo !== 'porcentaje'
    ) {
      throw new BadRequestException('Este tipo solo admite modo porcentaje');
    }

    if (tiposConValorUnico.includes(codigo)) {
      if (!dto.valor)
        throw new BadRequestException('El valor es requerido para este tipo');
      this.validarValor(dto.modo ?? 'porcentaje', dto.valor);
    }

    if (codigo === 'pronto_pago' || codigo === 'mora') {
      if (dto.diasVencimiento == null)
        throw new BadRequestException('Días de vencimiento requerido');
    }

    if (codigo === 'mora') {
      if (dto.diasVencimiento! < 0 || dto.diasVencimiento! > 365)
        throw new BadRequestException(
          'Días de vencimiento debe estar entre 0 y 365',
        );
    }

    if (codigo === 'promocional') {
      if (!dto.fechaInicio || !dto.fechaFin)
        throw new BadRequestException(
          'Fechas de inicio y fin requeridas para descuento promocional',
        );
    }
  }

  private derivarCondicionTipo(codigo: string): CondicionTipo {
    const map: Record<string, CondicionTipo> = {
      metodo_pago: CondicionTipo.METODO_PAGO,
      recargo_metodo_pago: CondicionTipo.METODO_PAGO,
      pronto_pago: CondicionTipo.VENCIMIENTO,
      mora: CondicionTipo.VENCIMIENTO,
    };
    return map[codigo] ?? CondicionTipo.NINGUNA;
  }

  private validarValor(modo: string, valor: string | null | undefined): void {
    if (!valor) return;
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) {
      throw new BadRequestException('El valor debe ser un número mayor a 0');
    }
    if (modo === 'porcentaje' && numero >= 1) {
      throw new BadRequestException(
        'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
      );
    }
  }
}
