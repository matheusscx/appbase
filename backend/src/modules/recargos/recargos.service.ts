import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateRecargoDto } from './dto/create-recargo.dto';
import { UpdateRecargoDto } from './dto/update-recargo.dto';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const CLASE = 'recargo';

@Injectable()
export class RecargosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Recargo)
    private readonly recargoRepo: Repository<Recargo>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(RecargoTramo)
    private readonly tramoRepo: Repository<RecargoTramo>,
    @InjectRepository(RecargoMetodoPago)
    private readonly metodoPagoRepo: Repository<RecargoMetodoPago>,
  ) {}

  async findAll(tenantId: string) {
    const reglas = await this.recargoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
    const ids = reglas.map((r) => r.id);

    const tramos = ids.length
      ? await this.tramoRepo.find({
          where: { recargoId: In(ids) },
          order: { orden: 'ASC' },
        })
      : [];

    const metodos = ids.length
      ? await this.metodoPagoRepo.find({
          where: { recargoId: In(ids) },
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
        .filter((t) => t.recargoId === r.id)
        .map((t) => ({ minimo: t.minimo, valor: t.valor })),
      metodoPagoIds: metodos
        .filter((m) => m.recargoId === r.id)
        .map((m) => m.metodoPagoId),
      diasVencimiento: r.condicionValor ? parseInt(r.condicionValor, 10) : null,
    }));
  }

  async create(tenantId: string, dto: CreateRecargoDto) {
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

      const recargo = manager.create(Recargo, {
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
      await manager.save(recargo);

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(RecargoTramo, {
            recargoId: recargo.id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(RecargoMetodoPago, {
            recargoId: recargo.id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return recargo;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRecargoDto) {
    const recargo = await this.recargoRepo.findOne({ where: { id, tenantId } });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);

    let tipoRegla: TipoRegla;
    if (dto.tipoReglaId) {
      tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    } else {
      const tipo = await this.tipoReglaRepo.findOne({
        where: { id: recargo.tipoReglaId },
      });
      if (!tipo)
        throw new BadRequestException(
          'El tipo de regla seleccionado no existe',
        );
      tipoRegla = tipo;
    }

    await this.validarNombreUnico(tenantId, dto.nombre ?? recargo.nombre, id);
    this.validarSegunTipo(tipoRegla.codigo, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const tiposConDias = ['pronto_pago', 'mora'];
      const condicionValor =
        dto.diasVencimiento != null
          ? String(dto.diasVencimiento)
          : tiposConDias.includes(tipoRegla.codigo) && recargo.condicionValor
            ? recargo.condicionValor
            : null;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : ((dto.modo as ModoRegla) ?? recargo.modo);

      Object.assign(recargo, {
        ...dto,
        modo,
        condicionTipo,
        condicionValor,
      });
      await manager.save(recargo);

      // Replace all children
      await manager.delete(RecargoTramo, { recargoId: id });
      await manager.delete(RecargoMetodoPago, { recargoId: id });

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(RecargoTramo, {
            recargoId: id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(RecargoMetodoPago, {
            recargoId: id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return recargo;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const recargo = await this.recargoRepo.findOne({ where: { id, tenantId } });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);
    await this.recargoRepo.softDelete({ id, tenantId });
  }

  async nombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<{ disponible: boolean }> {
    const qb = this.recargoRepo
      .createQueryBuilder('r')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.nombre = :nombre', { nombre })
      .andWhere('r.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('r.recargo_id != :excludeId', { excludeId });
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
        'El tipo seleccionado no corresponde a un recargo',
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
        `Ya existe un recargo con el nombre "${nombre}"`,
      );
  }

  private validarSegunTipo(
    codigo: string,
    dto: CreateRecargoDto | UpdateRecargoDto,
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
