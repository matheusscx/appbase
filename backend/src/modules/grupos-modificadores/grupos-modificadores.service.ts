import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import {
  CreateGrupoModificadorDto,
  GrupoOpcionInputDto,
} from './dto/create-grupo-modificador.dto';
import { UpdateGrupoModificadorDto } from './dto/update-grupo-modificador.dto';
import { AplicarOverridesDto } from './dto/aplicar-overrides.dto';
import { CatalogService } from '../catalog/catalog.service';

export type FamiliaEfecto = 'ingrediente' | 'vendible';

export interface OpcionResuelta {
  itemId: string;
  itemNombre: string;
  tipo: string;
  cantidad: string | null;
  unidadCodigo: string | null;
  precioExtra: string;
  orden: number;
}

interface OpcionRow {
  grupo_opcion_id: string;
  item_id: string;
  item_nombre: string;
  tipo: string;
  cantidad: string | null;
  unidad_codigo: string | null;
  precio_extra: string;
  orden: number;
  stock: string | null;
}

@Injectable()
export class GruposModificadoresService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly catalogService: CatalogService,
  ) {}

  private familiaDeTipo(tipo: string): FamiliaEfecto {
    return tipo === 'ingrediente' ? 'ingrediente' : 'vendible';
  }

  private mapOpcionRow(r: OpcionRow) {
    return {
      grupoOpcionId: r.grupo_opcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      tipo: r.tipo,
      cantidad: r.cantidad,
      unidadCodigo: r.unidad_codigo,
      precioExtra: r.precio_extra,
      orden: r.orden,
      stock: r.stock,
    };
  }

  /**
   * Valida homogeneidad y cada opción. No inserta por sí misma: si se pasa
   * `onResuelto`, se invoca (p.ej. para persistir) inmediatamente después de
   * resolver cada opción individual, antes de pasar a la siguiente — así el
   * caller puede intercalar validación + persistencia opción por opción.
   * Reusado por create/update (Task 2).
   */
  private async validarYResolverOpciones(
    manager: EntityManager,
    tenantId: string,
    opciones: GrupoOpcionInputDto[],
    onResuelto?: (opcion: OpcionResuelta) => Promise<void>,
  ): Promise<{ familia: FamiliaEfecto; opciones: OpcionResuelta[] }> {
    if (!opciones.length) {
      throw new BadRequestException('El grupo requiere al menos una opción');
    }
    const vistos = new Set<string>();
    let familia: FamiliaEfecto | null = null;
    const resueltas: OpcionResuelta[] = [];
    let ordenAuto = 0;
    for (const op of opciones) {
      if (vistos.has(op.itemId)) {
        throw new BadRequestException(
          'Un item no puede aparecer más de una vez como opción del grupo',
        );
      }
      vistos.add(op.itemId);

      let precioExtra: Decimal;
      try {
        precioExtra = new Decimal(op.precioExtra);
      } catch {
        throw new BadRequestException(
          'El precio extra debe ser un número mayor o igual a 0',
        );
      }
      if (precioExtra.isNaN() || precioExtra.lessThan(0)) {
        throw new BadRequestException(
          'El precio extra debe ser mayor o igual a 0',
        );
      }
      if (
        op.cantidad !== undefined &&
        op.cantidad !== null &&
        op.cantidad !== ''
      ) {
        if (new Decimal(op.cantidad).lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'La cantidad de la opción debe ser mayor a 0',
          );
        }
      }

      const rows: {
        tipo: string;
        nombre: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, i.nombre, ip.modo_inventario, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [op.itemId, tenantId],
      );
      if (!rows.length) {
        throw new BadRequestException(`Opción no encontrada: ${op.itemId}`);
      }
      const { tipo, nombre, modo_inventario, unidad_medida } = rows[0];
      if (!['producto', 'receta', 'servicio', 'ingrediente'].includes(tipo)) {
        throw new BadRequestException(
          `Una opción de grupo debe ser ingrediente, producto, receta o servicio (recibido: ${tipo})`,
        );
      }
      const familiaOp = this.familiaDeTipo(tipo);
      if (familia === null) {
        familia = familiaOp;
      } else if (familia !== familiaOp) {
        throw new BadRequestException(
          'Todas las opciones del grupo deben ser de la misma familia (ingrediente o vendible)',
        );
      }

      let unidadCodigo: string | null = null;
      if (familiaOp === 'ingrediente') {
        if (modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            'Las opciones ingrediente solo admiten modo de inventario "cantidad"',
          );
        }
        // Con default de cantidad, exigir y verificar la unidad. Sin default,
        // la unidad se define en el override por receta (Task 3).
        if (op.cantidad != null && op.cantidad !== '') {
          if (!op.unidadCodigo) {
            throw new BadRequestException(
              'Las opciones ingrediente con cantidad requieren unidad de medida',
            );
          }
          // Verifica magnitud/convertibilidad contra la unidad base del ingrediente.
          await this.catalogService.convertirUnidad(
            op.cantidad,
            op.unidadCodigo,
            unidad_medida!,
          );
          unidadCodigo = op.unidadCodigo;
        } else if (op.unidadCodigo) {
          unidadCodigo = op.unidadCodigo; // unidad default sin cantidad default: se permite
        }
      }

      const orden = op.orden ?? ordenAuto;
      const resuelta: OpcionResuelta = {
        itemId: op.itemId,
        itemNombre: nombre,
        tipo,
        cantidad:
          op.cantidad != null && op.cantidad !== '' ? op.cantidad : null,
        unidadCodigo,
        precioExtra: op.precioExtra,
        orden,
      };
      if (onResuelto) {
        await onResuelto(resuelta);
      }
      resueltas.push(resuelta);
      // El siguiente auto-orden continúa desde el que se acaba de usar, así un
      // orden explícito no colisiona con los auto-asignados posteriores.
      ordenAuto = orden + 1;
    }
    return { familia: familia!, opciones: resueltas };
  }

  private async assertNombreLibre(
    manager: EntityManager,
    tenantId: string,
    nombre: string,
    exceptoId?: string,
  ): Promise<void> {
    const rows: { grupo_modificador_id: string }[] = await manager.query(
      `SELECT grupo_modificador_id FROM grupos_modificadores
       WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2) AND eliminado_el IS NULL
         AND ($3::uuid IS NULL OR grupo_modificador_id <> $3)`,
      [tenantId, nombre, exceptoId ?? null],
    );
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un grupo con el nombre "${nombre}"`,
      );
    }
  }

  async create(tenantId: string, dto: CreateGrupoModificadorDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertNombreLibre(manager, tenantId, dto.nombre);
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `INSERT INTO grupos_modificadores (tenant_id, nombre)
         VALUES ($1,$2) RETURNING grupo_modificador_id`,
        [tenantId, dto.nombre],
      );
      const grupoId = grupoRows[0].grupo_modificador_id;
      const resueltas: (OpcionResuelta & { grupoOpcionId: string })[] = [];
      const { familia } = await this.validarYResolverOpciones(
        manager,
        tenantId,
        dto.opciones,
        async (op) => {
          const rows: { grupo_opcion_id: string }[] = await manager.query(
            `INSERT INTO grupo_modificador_opciones
               (tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING grupo_opcion_id`,
            [
              tenantId,
              grupoId,
              op.itemId,
              op.cantidad,
              op.unidadCodigo,
              op.precioExtra,
              op.orden,
            ],
          );
          resueltas.push({ ...op, grupoOpcionId: rows[0].grupo_opcion_id });
        },
      );
      return {
        grupoModificadorId: grupoId,
        nombre: dto.nombre,
        familia,
        opciones: resueltas,
        // Grupo recién creado: aún no puede estar asociado a ningún item.
        // Se incluye para que la respuesta comparta shape con GET/PATCH.
        itemsUsandoCount: 0,
      };
    });
  }

  /**
   * Carga un grupo vivo con sus opciones vivas y el conteo de items vivos
   * que lo usan. Reusado por findAll/findOne y por update cuando no se
   * reemplazan opciones. Acepta tanto el DataSource como un EntityManager
   * de transacción (ambos exponen `query`).
   */
  private async cargarGrupo(
    runner: { query: <T = unknown>(q: string, p?: unknown[]) => Promise<T> },
    tenantId: string,
    grupoId: string,
  ) {
    const grupoRows: { grupo_modificador_id: string; nombre: string }[] =
      await runner.query(
        `SELECT grupo_modificador_id, nombre FROM grupos_modificadores
         WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [grupoId, tenantId],
      );
    if (!grupoRows.length) return null;

    const opRows: OpcionRow[] = await runner.query(
      `SELECT o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
              o.cantidad, o.unidad_codigo, o.precio_extra, o.orden, ip.stock
       FROM grupo_modificador_opciones o
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_producto ip ON ip.item_id = o.item_id
       WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
       ORDER BY o.orden ASC`,
      [grupoId, tenantId],
    );

    const usoRows: { total: number }[] = await runner.query(
      `SELECT COUNT(*)::int AS total FROM item_grupos_modificadores igm
       JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
       WHERE igm.grupo_modificador_id = $1 AND igm.eliminado_el IS NULL`,
      [grupoId],
    );

    const familia = opRows.length ? this.familiaDeTipo(opRows[0].tipo) : null;
    return {
      grupoModificadorId: grupoRows[0].grupo_modificador_id,
      nombre: grupoRows[0].nombre,
      familia,
      opciones: opRows.map((r) => this.mapOpcionRow(r)),
      itemsUsandoCount: usoRows[0]?.total ?? 0,
    };
  }

  /**
   * Lista los grupos del tenant con opciones y conteo de uso. Batchea las
   * opciones y los conteos en una sola query cada uno (3 queries totales,
   * no N+1 por grupo).
   */
  async findAll(tenantId: string) {
    const grupoRows: { grupo_modificador_id: string; nombre: string }[] =
      await this.dataSource.query(
        `SELECT grupo_modificador_id, nombre FROM grupos_modificadores
         WHERE tenant_id = $1 AND eliminado_el IS NULL ORDER BY nombre ASC`,
        [tenantId],
      );
    if (!grupoRows.length) return [];
    const ids = grupoRows.map((g) => g.grupo_modificador_id);

    const opRows: (OpcionRow & { grupo_modificador_id: string })[] =
      await this.dataSource.query(
        `SELECT o.grupo_modificador_id, o.grupo_opcion_id, o.item_id,
                i.nombre AS item_nombre, i.tipo, o.cantidad, o.unidad_codigo,
                o.precio_extra, o.orden, ip.stock
         FROM grupo_modificador_opciones o
         JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = o.item_id
         WHERE o.grupo_modificador_id = ANY($1::uuid[]) AND o.tenant_id = $2
           AND o.eliminado_el IS NULL
         ORDER BY o.orden ASC`,
        [ids, tenantId],
      );

    const usoRows: { grupo_modificador_id: string; total: number }[] =
      await this.dataSource.query(
        `SELECT igm.grupo_modificador_id, COUNT(*)::int AS total
         FROM item_grupos_modificadores igm
         JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
         WHERE igm.grupo_modificador_id = ANY($1::uuid[]) AND igm.eliminado_el IS NULL
         GROUP BY igm.grupo_modificador_id`,
        [ids],
      );

    const opcionesPorGrupo = new Map<string, OpcionRow[]>();
    for (const r of opRows) {
      const list = opcionesPorGrupo.get(r.grupo_modificador_id) ?? [];
      list.push(r);
      opcionesPorGrupo.set(r.grupo_modificador_id, list);
    }
    const usoPorGrupo = new Map<string, number>(
      usoRows.map((u) => [u.grupo_modificador_id, u.total]),
    );

    return grupoRows.map((g) => {
      const ops = opcionesPorGrupo.get(g.grupo_modificador_id) ?? [];
      return {
        grupoModificadorId: g.grupo_modificador_id,
        nombre: g.nombre,
        familia: ops.length ? this.familiaDeTipo(ops[0].tipo) : null,
        opciones: ops.map((r) => this.mapOpcionRow(r)),
        itemsUsandoCount: usoPorGrupo.get(g.grupo_modificador_id) ?? 0,
      };
    });
  }

  async findOne(tenantId: string, grupoId: string) {
    const grupo = await this.cargarGrupo(this.dataSource, tenantId, grupoId);
    if (!grupo)
      throw new NotFoundException('Grupo de modificadores no encontrado');
    return grupo;
  }

  /**
   * Upsert-preservando de opciones: las que siguen vivas (mismo item_id)
   * reciben UPDATE conservando su grupo_opcion_id — clave de la que cuelgan
   * los overrides en item_grupo_modificador_opciones —, las nuevas se
   * insertan, y las que desaparecen se soft-borran junto con sus overrides.
   * Preserva homogeneidad de familia vía validarYResolverOpciones. Si el
   * nombre no cambia se evita el UPDATE de nombre, pero igual se verifica
   * disponibilidad (assertNombreLibre con exceptoId = el propio grupo)
   * cuando viene en el DTO.
   */
  async update(
    tenantId: string,
    grupoId: string,
    dto: UpdateGrupoModificadorDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const grupoRows: { grupo_modificador_id: string; nombre: string }[] =
        await manager.query(
          `SELECT grupo_modificador_id, nombre FROM grupos_modificadores
           WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [grupoId, tenantId],
        );
      if (!grupoRows.length) {
        throw new NotFoundException('Grupo de modificadores no encontrado');
      }

      if (dto.nombre !== undefined && dto.nombre !== grupoRows[0].nombre) {
        await this.assertNombreLibre(manager, tenantId, dto.nombre, grupoId);
        await manager.query(
          `UPDATE grupos_modificadores SET nombre = $1, actualizado_el = NOW()
           WHERE grupo_modificador_id = $2`,
          [dto.nombre, grupoId],
        );
      }

      if (dto.opciones === undefined) {
        // El grupo se acaba de confirmar vivo arriba, dentro de la misma
        // transacción: cargarGrupo no puede devolver null aquí.
        return (await this.cargarGrupo(manager, tenantId, grupoId))!;
      }

      // Upsert-preservando: mantiene el grupo_opcion_id de las opciones cuyo
      // item_id sigue vivo (UPDATE en vez de delete+insert), para no
      // huerfanar los overrides en item_grupo_modificador_opciones (llave =
      // grupo_opcion_id). Las opciones que desaparecen se soft-borran junto
      // con sus overrides.
      const vivas: { grupo_opcion_id: string; item_id: string }[] =
        await manager.query(
          `SELECT grupo_opcion_id, item_id FROM grupo_modificador_opciones
           WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [grupoId, tenantId],
        );
      const opcionIdPorItem = new Map(
        vivas.map((r) => [r.item_id, r.grupo_opcion_id]),
      );
      const itemsEntrantes = new Set<string>();

      await this.validarYResolverOpciones(
        manager,
        tenantId,
        dto.opciones,
        async (op) => {
          itemsEntrantes.add(op.itemId);
          const existente = opcionIdPorItem.get(op.itemId);
          if (existente) {
            await manager.query(
              `UPDATE grupo_modificador_opciones SET
                 cantidad = $1, unidad_codigo = $2, precio_extra = $3, orden = $4,
                 actualizado_el = NOW()
               WHERE grupo_opcion_id = $5`,
              [
                op.cantidad,
                op.unidadCodigo,
                op.precioExtra,
                op.orden,
                existente,
              ],
            );
          } else {
            await manager.query(
              `INSERT INTO grupo_modificador_opciones
                 (tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               RETURNING grupo_opcion_id`,
              [
                tenantId,
                grupoId,
                op.itemId,
                op.cantidad,
                op.unidadCodigo,
                op.precioExtra,
                op.orden,
              ],
            );
          }
        },
      );

      // Opciones que desaparecieron: soft-delete de la opción y de sus overrides.
      const eliminadas = vivas.filter((r) => !itemsEntrantes.has(r.item_id));
      if (eliminadas.length) {
        const idsEliminadas = eliminadas.map((r) => r.grupo_opcion_id);
        await manager.query(
          `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
          [idsEliminadas],
        );
        await manager.query(
          `UPDATE grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
          [idsEliminadas],
        );
      }

      return (await this.cargarGrupo(manager, tenantId, grupoId))!;
    });
  }

  /**
   * Borra (soft-delete) un grupo y sus opciones, bloqueando si hay items
   * vivos que lo usan. Todo dentro de una única transacción para que el
   * chequeo de uso y el borrado sean atómicos.
   */
  async remove(tenantId: string, grupoId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `SELECT grupo_modificador_id FROM grupos_modificadores
           WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [grupoId, tenantId],
      );
      if (!grupoRows.length) {
        throw new NotFoundException('Grupo de modificadores no encontrado');
      }

      const usoRows: { nombre: string }[] = await manager.query(
        `SELECT DISTINCT i.nombre FROM item_grupos_modificadores igm
         JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
         WHERE igm.grupo_modificador_id = $1 AND igm.eliminado_el IS NULL`,
        [grupoId],
      );
      if (usoRows.length) {
        throw new BadRequestException(
          `No se puede eliminar: el grupo está asociado a ${usoRows.map((r) => r.nombre).join(', ')}`,
        );
      }

      await manager.query(
        `UPDATE grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL`,
        [grupoId],
      );
      await manager.query(
        `UPDATE grupos_modificadores SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE grupo_modificador_id = $1`,
        [grupoId],
      );
    });
  }

  /**
   * Lista, para el drawer de "dónde se usa este grupo", todas las recetas/
   * combos vivos que lo tienen asociado junto con el estado efectivo
   * (COALESCE override → default) de cada opción. Batchea las opciones de
   * todas las asociaciones en una sola query (evita N+1 por item).
   */
  async itemsUsando(tenantId: string, grupoId: string) {
    const asociaciones: {
      item_grupo_id: string;
      item_id: string;
      item_nombre: string;
      tipo: string;
    }[] = await this.dataSource.query(
      `SELECT igm.item_grupo_id, i.item_id, i.nombre AS item_nombre, i.tipo
       FROM item_grupos_modificadores igm
       JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
       WHERE igm.grupo_modificador_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
       ORDER BY i.nombre ASC`,
      [grupoId, tenantId],
    );
    if (!asociaciones.length) return [];

    const igIds = asociaciones.map((a) => a.item_grupo_id);
    const opRows: {
      item_grupo_id: string;
      grupo_opcion_id: string;
      item_nombre: string;
      cantidad_efectiva: string | null;
      cantidad_default: string | null;
      unidad_codigo: string | null;
      precio_extra: string;
      orden: number;
    }[] = await this.dataSource.query(
      `SELECT igm.item_grupo_id, o.grupo_opcion_id, i.nombre AS item_nombre,
              COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
              o.cantidad AS cantidad_default,
              COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
              COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
              o.orden
       FROM item_grupos_modificadores igm
       JOIN grupo_modificador_opciones o ON o.grupo_modificador_id = igm.grupo_modificador_id
         AND o.eliminado_el IS NULL
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_grupo_modificador_opciones ovr
         ON ovr.grupo_opcion_id = o.grupo_opcion_id AND ovr.item_grupo_id = igm.item_grupo_id
        AND ovr.eliminado_el IS NULL
       WHERE igm.item_grupo_id = ANY($1::uuid[]) AND igm.tenant_id = $2
       ORDER BY o.orden ASC`,
      [igIds, tenantId],
    );

    const opsPorIg = new Map<string, typeof opRows>();
    for (const r of opRows) {
      const list = opsPorIg.get(r.item_grupo_id) ?? [];
      list.push(r);
      opsPorIg.set(r.item_grupo_id, list);
    }

    return asociaciones.map((a) => ({
      itemId: a.item_id,
      itemNombre: a.item_nombre,
      tipo: a.tipo,
      itemGrupoId: a.item_grupo_id,
      opciones: (opsPorIg.get(a.item_grupo_id) ?? []).map((r) => ({
        grupoOpcionId: r.grupo_opcion_id,
        itemNombre: r.item_nombre,
        cantidad: r.cantidad_efectiva,
        cantidadDefault: r.cantidad_default,
        unidadCodigo: r.unidad_codigo,
        precioExtra: r.precio_extra,
        esPendiente: r.cantidad_efectiva == null,
      })),
    }));
  }

  /**
   * Aplica en lote el mismo override (cantidad/unidad/precioExtra) a varias
   * asociaciones item↔grupo del mismo grupo_opcion_id — upsert-preservando
   * por (item_grupo_id, grupo_opcion_id), análoga a upsertOverridesDeGrupo
   * (Task 3) pero resolviendo por el lado del grupo. Valida que el grupo
   * exista, que la opción pertenezca al grupo, y que cada item_grupo_id sea
   * una asociación viva de ESTE grupo en este tenant.
   */
  async aplicarOverrides(
    tenantId: string,
    grupoId: string,
    dto: AplicarOverridesDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `SELECT grupo_modificador_id FROM grupos_modificadores
           WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [grupoId, tenantId],
      );
      if (!grupoRows.length) {
        throw new NotFoundException('Grupo de modificadores no encontrado');
      }

      const opRows: { grupo_opcion_id: string }[] = await manager.query(
        `SELECT grupo_opcion_id FROM grupo_modificador_opciones
         WHERE grupo_opcion_id = $1 AND grupo_modificador_id = $2 AND tenant_id = $3
           AND eliminado_el IS NULL`,
        [dto.grupoOpcionId, grupoId, tenantId],
      );
      if (!opRows.length) {
        throw new BadRequestException('La opción no pertenece al grupo');
      }

      // item_grupo_ids válidos: asociaciones vivas de ESTE grupo en ESTE tenant.
      const validos: { item_grupo_id: string }[] = await manager.query(
        `SELECT item_grupo_id FROM item_grupos_modificadores
         WHERE item_grupo_id = ANY($1::uuid[]) AND grupo_modificador_id = $2
           AND tenant_id = $3 AND eliminado_el IS NULL`,
        [dto.itemGrupoIds, grupoId, tenantId],
      );
      const validSet = new Set(validos.map((r) => r.item_grupo_id));
      for (const ig of dto.itemGrupoIds) {
        if (!validSet.has(ig)) {
          throw new BadRequestException(
            `item_grupo_id no válido para este grupo: ${ig}`,
          );
        }
      }

      if (
        dto.cantidad != null &&
        dto.cantidad !== '' &&
        new Decimal(dto.cantidad).lessThanOrEqualTo(0)
      ) {
        throw new BadRequestException('La cantidad debe ser mayor a 0');
      }
      if (
        dto.precioExtra != null &&
        dto.precioExtra !== '' &&
        new Decimal(dto.precioExtra).lessThan(0)
      ) {
        throw new BadRequestException(
          'El precio extra debe ser mayor o igual a 0',
        );
      }
      const cantidad =
        dto.cantidad != null && dto.cantidad !== '' ? dto.cantidad : null;
      const unidad = dto.unidadCodigo || null;
      const precio =
        dto.precioExtra != null && dto.precioExtra !== ''
          ? dto.precioExtra
          : null;

      let actualizados = 0;
      for (const itemGrupoId of dto.itemGrupoIds) {
        const vivos: { item_grupo_opcion_id: string }[] = await manager.query(
          `SELECT item_grupo_opcion_id FROM item_grupo_modificador_opciones
           WHERE item_grupo_id = $1 AND grupo_opcion_id = $2 AND eliminado_el IS NULL`,
          [itemGrupoId, dto.grupoOpcionId],
        );
        if (vivos.length) {
          await manager.query(
            `UPDATE item_grupo_modificador_opciones
             SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, actualizado_el = NOW()
             WHERE item_grupo_opcion_id = $4`,
            [cantidad, unidad, precio, vivos[0].item_grupo_opcion_id],
          );
        } else {
          await manager.query(
            `INSERT INTO item_grupo_modificador_opciones
               (tenant_id, item_grupo_id, grupo_opcion_id, cantidad, unidad_codigo, precio_extra)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              tenantId,
              itemGrupoId,
              dto.grupoOpcionId,
              cantidad,
              unidad,
              precio,
            ],
          );
        }
        actualizados++;
      }
      return { actualizados };
    });
  }
}
