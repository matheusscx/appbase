import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { errorDeColisionNombre } from '../../common/utils/nombre-sugerido.util';
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
    private readonly db: Db,
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
    const rows: { pais_id: string }[] = await this.db.query(
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

  /**
   * Si el nombre está libre para ESTE tenant. Espeja
   * `descuentos.service.ts → nombreDisponible()`, y como allá la comparación es
   * `LOWER() = LOWER()` para que coincida con el índice
   * `uq_impuestos_tenant_nombre_vivo`, que es sobre `lower(nombre)`: con una
   * comparación exacta el endpoint diría "libre" y el guardado fallaría 23505.
   *
   * `tenant_id = :tenantId` deja **afuera al catálogo del país** —sus filas
   * tienen `tenant_id` nulo— y eso es deliberado: el índice tampoco las cubre.
   * Un tenant puede llamar "IVA" a un impuesto propio aunque el país tenga el
   * suyo; en el listado se distinguen por el badge Sistema/Personalizado, que
   * `findAll` alimenta con `origen`.
   */
  async nombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<{ disponible: boolean }> {
    const qb = this.impuestoRepo
      .createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(i.nombre) = LOWER(:nombre)', { nombre })
      .andWhere('i.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('i.impuesto_id != :excludeId', { excludeId });
    }
    return { disponible: (await qb.getCount()) === 0 };
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
    if (!disponible) {
      throw new BadRequestException(
        `Ya existe un impuesto con el nombre "${nombre}"`,
      );
    }
  }

  async create(tenantId: string, dto: CreateImpuestoDto): Promise<Impuesto> {
    this.validarPorcentaje(dto.porcentaje);
    await this.validarNombreUnico(tenantId, dto.nombre);
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
    // `excludeId`: renombrar un impuesto dejándole el mismo nombre no puede
    // chocar contra sí mismo.
    if (dto.nombre !== undefined) {
      await this.validarNombreUnico(tenantId, dto.nombre, id);
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

  /**
   * Consulta inversa a `ItemsService.obtenerUso`: dado un impuesto, los
   * ítems vivos que lo usan. Alimenta el modal de confirmación al pausar
   * ("deja de aplicarse en N ítems"). Una sola query con JOIN — nunca una
   * por fila —, acotada por tenant y `eliminado_el IS NULL` sobre `items`
   * (la tabla puente `item_impuestos` no tiene `tenant_id` ni `eliminado_el`
   * propios). El precheck por `{ id, tenantId }` sigue el mismo alcance que
   * `update()`/`remove()`: un impuesto de sistema (`tenantId` null,
   * compartido por país) no es de este tenant y no se puede pausar, así que
   * tampoco expone su uso acá.
   */
  async obtenerUso(
    tenantId: string,
    id: string,
  ): Promise<{ items: { id: string; nombre: string }[] }> {
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
    });
    if (!impuesto) throw new NotFoundException(`Impuesto ${id} no encontrado`);

    const items: { id: string; nombre: string }[] = await this.db.query(
      `SELECT i.item_id AS id, i.nombre
         FROM item_impuestos ii
         JOIN items i ON i.item_id = ii.item_id
          AND i.tenant_id = $2 AND i.eliminado_el IS NULL
        WHERE ii.impuesto_id = $1
        ORDER BY i.nombre ASC`,
      [id, tenantId],
    );

    return { items };
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<Impuesto> {
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
    const nombre = nombreNuevo ?? impuesto.nombre;
    try {
      // Revivir y renombrar van en la MISMA escritura: dos sentencias dejarían
      // una ventana con la fila viva y el nombre en colisión.
      await this.impuestoRepo.update(
        { id, tenantId },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          ...(nombreNuevo ? { nombre: nombreNuevo } : {}),
        },
      );
    } catch (e) {
      // 23505 = unique_violation. `uq_impuestos_tenant_nombre_vivo` es parcial
      // (WHERE eliminado_el IS NULL): mientras el impuesto estaba borrado nadie
      // competía por el nombre, pero al revivirlo vuelve a competir. Se capta el
      // código de Postgres —no el nombre del índice— para que valga también
      // donde no lo enumeramos. Mismo patrón que descuentos, recargos y cajones.
      if ((e as { code?: string }).code === '23505') {
        // La sugerencia se calcula ACÁ y no antes del `UPDATE` a propósito: con
        // índice único el `catch` hace falta igual —entre consultar y escribir
        // otra transacción puede tomar el nombre—, así que pre-consultar
        // agregaría una query en TODOS los restaurar sin poder sacar este
        // bloque.
        throw new BadRequestException(
          await errorDeColisionNombre(
            this.impuestoRepo,
            'i',
            'un impuesto activo',
            tenantId,
            nombre,
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
    return this.impuestoRepo.findOneOrFail({ where: { id, tenantId } });
  }
}
