import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Impuesto } from './entities/impuesto.entity';
import { CreateImpuestoDto } from './dto/create-impuesto.dto';
import { UpdateImpuestoDto } from './dto/update-impuesto.dto';

export type ImpuestoConOrigen = Impuesto & {
  origen: 'sistema' | 'personalizado';
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class ImpuestosService {
  constructor(
    @InjectRepository(Impuesto)
    private readonly impuestoRepo: Repository<Impuesto>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private validarPorcentaje(porcentaje: string): void {
    let value: Decimal;
    try {
      value = new Decimal(porcentaje);
    } catch {
      throw new BadRequestException('El porcentaje debe ser mayor a 0');
    }
    if (value.isNaN() || value.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El porcentaje debe ser mayor a 0');
    }
  }

  /** País del tenant: tenants.provincia_id → provincia.pais_id. */
  private async paisIdDeTenant(tenantId: string): Promise<string | null> {
    const rows: { pais_id: string }[] = await this.dataSource.query(
      `SELECT p.pais_id
         FROM tenants t
         JOIN provincia p ON p.provincia_id = t.provincia_id AND p.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0]?.pais_id ?? null;
  }

  async findAll(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<ImpuestoConOrigen[]> {
    const paisId = await this.paisIdDeTenant(tenantId);
    let impuestos: (Impuesto & { eliminadoPorNombre?: string | null })[];
    if (!incluirEliminados) {
      impuestos = await this.impuestoRepo.find({
        where: paisId ? [{ tenantId }, { paisId }] : { tenantId },
        order: { nombre: 'ASC' },
      });
    } else {
      // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
      // los `addSelect` que no mapean a una columna de la entity, así que hay
      // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
      // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
      // documentada: el autor de un borrado es un hecho histórico).
      const qb = this.impuestoRepo
        .createQueryBuilder('i')
        .leftJoin('usuarios', 'u', 'u.usuario_id = i.eliminado_por')
        .addSelect('u.nombre_usuario', 'i_eliminado_por_nombre')
        .withDeleted()
        .orderBy('i.nombre', 'ASC');
      // ⚠️ Los paréntesis de este `OR` NO son cosméticos. TypeORM concatena
      // `where`/`andWhere` con `AND` **sin parentizar cada uno** (salvo con
      // `isolateWhereStatements`, que no está activado), así que sin ellos el
      // SQL emitido es `WHERE tenant_id = $1 OR pais_id = $2 AND (...)` y el
      // `AND` liga más fuerte: las filas del tenant se saltaban el filtro de
      // abajo entero. Este es el único listado de los 16 recursos de la
      // papelera con un WHERE de dos ramas, y fue el único que falló.
      if (paisId) {
        qb.where('(i.tenant_id = :tenantId OR i.pais_id = :paisId)', {
          tenantId,
          paisId,
        });
      } else {
        qb.where('i.tenant_id = :tenantId', { tenantId });
      }
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema (seeder, `remapImpuestosOficialesDuplicados` —
      // justo lo que este listado NO debe reabrir: son los IVA duplicados
      // que evitan la doble tributación del 38%, ver ADR-018), no
      // restaurable ni visible — decisión del owner, docs/features/papelera.md.
      // Va DESPUÉS de los `.where()` de arriba: `.where()` en TypeORM
      // reemplaza el WHERE entero, así que un `.andWhere()` antes se
      // perdería.
      qb.andWhere('(i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)');
      const { entities, raw } = await qb.getRawAndEntities<{
        i_eliminado_por_nombre: string | null;
      }>();
      impuestos = entities.map((i, idx) => ({
        ...i,
        eliminadoPorNombre: raw[idx].i_eliminado_por_nombre,
      }));
    }
    return impuestos.map((i) => ({
      ...i,
      origen: i.tenantId ? ('personalizado' as const) : ('sistema' as const),
    }));
  }

  async create(tenantId: string, dto: CreateImpuestoDto): Promise<Impuesto> {
    this.validarPorcentaje(dto.porcentaje);
    const impuesto = this.impuestoRepo.create({
      tenantId,
      nombre: dto.nombre,
      porcentaje: dto.porcentaje,
      activo: dto.activo ?? true,
      tipo: 'otro',
    });
    return this.impuestoRepo.save(impuesto);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateImpuestoDto,
  ): Promise<Impuesto> {
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
    });
    if (!impuesto) {
      throw new NotFoundException(`Impuesto ${id} no encontrado`);
    }
    if (dto.porcentaje !== undefined) {
      this.validarPorcentaje(dto.porcentaje);
    }
    Object.assign(impuesto, dto);
    return this.impuestoRepo.save(impuesto);
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
    });
    if (!impuesto) {
      throw new NotFoundException(`Impuesto ${id} no encontrado`);
    }
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.impuestoRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Impuesto> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo, p.ej. un duplicado de IVA
    // que remapImpuestosOficialesDuplicados soft-deleteó — ver ADR-018)—:
    // la papelera solo restaura lo que borró una persona (decisión del
    // owner, docs/features/papelera.md).
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!impuesto || !impuesto.eliminadoEl || !impuesto.eliminadoPor) {
      throw new NotFoundException(`Impuesto ${id} no está en la papelera`);
    }
    // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
    // viejo sobreviviría y disfrazaría un borrado del sistema posterior como
    // borrado de persona (ver categorias.service.ts → restaurar()). Acá es lo
    // más caro de todos los recursos: el borrado del sistema que se
    // disfrazaría es el de `remapImpuestosOficialesDuplicados`, o sea
    // restaurar el duplicado de IVA reabre la doble tributación del 38%
    // (ADR-018).
    await this.impuestoRepo.update(
      { id, tenantId },
      { eliminadoEl: null, eliminadoPor: null },
    );
    return this.impuestoRepo.findOneOrFail({ where: { id, tenantId } });
  }
}
