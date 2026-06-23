import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AjusteStockDto } from './dto/ajuste-stock.dto';
import { InventarioService } from '../inventario/inventario.service';

interface ItemRow {
  item_id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  activo: boolean;
  precio_base: string;
  precio_incluye_impuesto: boolean;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  creado_el: Date;
  stock: string | null;
  unidad_medida: string | null;
  fecha_elaboracion: Date | null;
  fecha_vencimiento: Date | null;
  duracion_estimada: number | null;
  requiere_cita: boolean | null;
}

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(ItemProducto)
    private readonly itemProductoRepo: Repository<ItemProducto>,
    @InjectRepository(ItemServicio)
    private readonly itemServicioRepo: Repository<ItemServicio>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly inventarioService: InventarioService,
  ) {}

  private readonly BASE_QUERY = `
    SELECT
      i.item_id, i.nombre, i.descripcion, i.tipo, i.activo,
      i.precio_base, i.precio_incluye_impuesto,
      i.moneda_id, i.categoria_id, i.creado_el,
      m.codigo_iso AS moneda_codigo, m.simbolo AS moneda_simbolo,
      c.nombre AS categoria_nombre,
      ip.stock, ip.unidad_medida, ip.fecha_elaboracion, ip.fecha_vencimiento,
      isr.duracion_estimada, isr.requiere_cita
    FROM items i
    LEFT JOIN moneda m ON m.moneda_id = i.moneda_id AND m.eliminado_el IS NULL
    LEFT JOIN categorias c ON c.categoria_id = i.categoria_id AND c.eliminado_el IS NULL
    LEFT JOIN item_producto ip ON ip.item_id = i.item_id
    LEFT JOIN item_servicio isr ON isr.item_id = i.item_id
  `;

  private mapRow(r: ItemRow) {
    return {
      id: r.item_id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      tipo: r.tipo,
      activo: r.activo,
      precioBase: r.precio_base,
      precioIncluyeImpuesto: r.precio_incluye_impuesto,
      monedaId: r.moneda_id,
      monedaCodigo: r.moneda_codigo,
      monedaSimbolo: r.moneda_simbolo,
      categoriaId: r.categoria_id,
      categoriaNombre: r.categoria_nombre,
      creadoEl: r.creado_el,
      stock: r.stock,
      unidadMedida: r.unidad_medida,
      fechaElaboracion: r.fecha_elaboracion,
      fechaVencimiento: r.fecha_vencimiento,
      duracionEstimada: r.duracion_estimada,
      requiereCita: r.requiere_cita,
    };
  }

  async findAll(tenantId: string, tipo?: string, categoriaId?: string) {
    let query =
      this.BASE_QUERY + ` WHERE i.tenant_id = $1 AND i.eliminado_el IS NULL`;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (tipo) {
      query += ` AND i.tipo = $${idx++}`;
      params.push(tipo);
    }
    if (categoriaId) {
      query += ` AND i.categoria_id = $${idx++}`;
      params.push(categoriaId);
    }

    query += ' ORDER BY i.nombre ASC';

    const rows: ItemRow[] = await this.dataSource.query(query, params);
    return rows.map((r) => this.mapRow(r));
  }

  async findOne(tenantId: string, itemId: string) {
    const rows: ItemRow[] = await this.dataSource.query(
      this.BASE_QUERY +
        ` WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Item no encontrado');

    const impuestosRows: { impuesto_id: string }[] =
      await this.dataSource.query(
        `SELECT impuesto_id FROM item_impuestos WHERE item_id = $1`,
        [itemId],
      );
    const recargosRows: { recargo_id: string }[] = await this.dataSource.query(
      `SELECT recargo_id FROM item_recargos WHERE item_id = $1`,
      [itemId],
    );
    const descuentosRows: { descuento_id: string }[] =
      await this.dataSource.query(
        `SELECT descuento_id FROM item_descuentos WHERE item_id = $1`,
        [itemId],
      );

    return {
      ...this.mapRow(rows[0]),
      impuestosIds: impuestosRows.map((r) => r.impuesto_id),
      recargosIds: recargosRows.map((r) => r.recargo_id),
      descuentosIds: descuentosRows.map((r) => r.descuento_id),
    };
  }

  async create(tenantId: string, usuarioId: string, dto: CreateItemDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.validarMoneda(manager, tenantId, dto.monedaId);
      if (dto.categoriaId) {
        await this.validarCategoria(manager, tenantId, dto.categoriaId);
      }
      if (dto.impuestosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.impuestosIds,
          'impuestos',
          'impuesto_id',
        );
      }
      if (dto.recargosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.recargosIds,
          'recargos',
          'recargo_id',
        );
      }
      if (dto.descuentosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.descuentosIds,
          'descuentos',
          'descuento_id',
        );
      }

      const itemRows: { item_id: string }[] = await manager.query(
        `INSERT INTO items
           (tenant_id, moneda_id, categoria_id, nombre, descripcion,
            precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING item_id`,
        [
          tenantId,
          dto.monedaId,
          dto.categoriaId ?? null,
          dto.nombre,
          dto.descripcion ?? null,
          dto.precioBase,
          dto.precioIncluyeImpuesto ?? false,
          dto.activo ?? true,
          dto.tipo,
        ],
      );
      const itemId = itemRows[0].item_id;

      if (dto.tipo === 'producto') {
        await manager.query(
          `INSERT INTO item_producto (item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            itemId,
            '0', // el saldo se materializa vía el movimiento inventario_inicial
            dto.unidadMedida ?? 'unidad',
            dto.fechaElaboracion ?? null,
            dto.fechaVencimiento ?? null,
          ],
        );

        const stockInicial = new Decimal(dto.stock ?? '0');
        if (stockInicial.greaterThan(0)) {
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId,
            itemId,
            usuarioId,
            tipo: 'entrada',
            motivo: 'inventario_inicial',
            cantidad: stockInicial.toString(),
            comentario: 'Stock inicial',
          });
        }
      } else {
        await manager.query(
          `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita)
           VALUES ($1,$2,$3)`,
          [itemId, dto.duracionEstimada ?? null, dto.requiereCita ?? false],
        );
      }

      await this.insertarRelaciones(
        manager,
        itemId,
        dto.impuestosIds ?? [],
        dto.recargosIds ?? [],
        dto.descuentosIds ?? [],
      );

      return { id: itemId };
    });
  }

  async update(tenantId: string, itemId: string, dto: UpdateItemDto) {
    return this.dataSource.transaction(async (manager) => {
      const existingRows: { item_id: string; tipo: string }[] =
        await manager.query(
          `SELECT item_id, tipo FROM items
           WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [itemId, tenantId],
        );
      if (!existingRows.length)
        throw new NotFoundException('Item no encontrado');
      const tipo = existingRows[0].tipo;

      if (dto.monedaId)
        await this.validarMoneda(manager, tenantId, dto.monedaId);
      if (dto.categoriaId) {
        await this.validarCategoria(manager, tenantId, dto.categoriaId);
      }
      if (dto.impuestosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.impuestosIds,
          'impuestos',
          'impuesto_id',
        );
      }
      if (dto.recargosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.recargosIds,
          'recargos',
          'recargo_id',
        );
      }
      if (dto.descuentosIds?.length) {
        await this.validarReglas(
          manager,
          tenantId,
          dto.descuentosIds,
          'descuentos',
          'descuento_id',
        );
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (dto.nombre !== undefined) {
        setClauses.push(`nombre = $${idx++}`);
        params.push(dto.nombre);
      }
      if (dto.descripcion !== undefined) {
        setClauses.push(`descripcion = $${idx++}`);
        params.push(dto.descripcion);
      }
      if (dto.precioBase !== undefined) {
        setClauses.push(`precio_base = $${idx++}`);
        params.push(dto.precioBase);
      }
      if (dto.monedaId !== undefined) {
        setClauses.push(`moneda_id = $${idx++}`);
        params.push(dto.monedaId);
      }
      if (dto.categoriaId !== undefined) {
        setClauses.push(`categoria_id = $${idx++}`);
        params.push(dto.categoriaId);
      }
      if (dto.precioIncluyeImpuesto !== undefined) {
        setClauses.push(`precio_incluye_impuesto = $${idx++}`);
        params.push(dto.precioIncluyeImpuesto);
      }
      if (dto.activo !== undefined) {
        setClauses.push(`activo = $${idx++}`);
        params.push(dto.activo);
      }

      if (setClauses.length) {
        setClauses.push(`actualizado_el = NOW()`);
        params.push(itemId, tenantId);
        await manager.query(
          `UPDATE items SET ${setClauses.join(', ')}
           WHERE item_id = $${idx++} AND tenant_id = $${idx++}`,
          params,
        );
      }

      if (tipo === 'producto') {
        const prodClauses: string[] = [];
        const prodParams: unknown[] = [];
        let pidx = 1;
        if (dto.stock !== undefined) {
          prodClauses.push(`stock = $${pidx++}`);
          prodParams.push(dto.stock);
        }
        if (dto.unidadMedida !== undefined) {
          prodClauses.push(`unidad_medida = $${pidx++}`);
          prodParams.push(dto.unidadMedida);
        }
        if (dto.fechaElaboracion !== undefined) {
          prodClauses.push(`fecha_elaboracion = $${pidx++}`);
          prodParams.push(dto.fechaElaboracion);
        }
        if (dto.fechaVencimiento !== undefined) {
          prodClauses.push(`fecha_vencimiento = $${pidx++}`);
          prodParams.push(dto.fechaVencimiento);
        }
        if (prodClauses.length) {
          prodParams.push(itemId);
          await manager.query(
            `UPDATE item_producto SET ${prodClauses.join(', ')} WHERE item_id = $${pidx++}`,
            prodParams,
          );
        }
      } else {
        const srvClauses: string[] = [];
        const srvParams: unknown[] = [];
        let sidx = 1;
        if (dto.duracionEstimada !== undefined) {
          srvClauses.push(`duracion_estimada = $${sidx++}`);
          srvParams.push(dto.duracionEstimada);
        }
        if (dto.requiereCita !== undefined) {
          srvClauses.push(`requiere_cita = $${sidx++}`);
          srvParams.push(dto.requiereCita);
        }
        if (srvClauses.length) {
          srvParams.push(itemId);
          await manager.query(
            `UPDATE item_servicio SET ${srvClauses.join(', ')} WHERE item_id = $${sidx++}`,
            srvParams,
          );
        }
      }

      if (dto.impuestosIds !== undefined) {
        await manager.query(`DELETE FROM item_impuestos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.impuestosIds) {
          await manager.query(
            `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
      }
      if (dto.recargosIds !== undefined) {
        await manager.query(`DELETE FROM item_recargos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.recargosIds) {
          await manager.query(
            `INSERT INTO item_recargos (item_id, recargo_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
      }
      if (dto.descuentosIds !== undefined) {
        await manager.query(`DELETE FROM item_descuentos WHERE item_id = $1`, [
          itemId,
        ]);
        for (const id of dto.descuentosIds) {
          await manager.query(
            `INSERT INTO item_descuentos (item_id, descuento_id) VALUES ($1,$2)`,
            [itemId, id],
          );
        }
      }

      return { id: itemId };
    });
  }

  async remove(tenantId: string, itemId: string): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException('Item no encontrado');
    await this.dataSource.query(
      `UPDATE items SET activo = false, eliminado_el = NOW(), actualizado_el = NOW()
       WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId],
    );
  }

  async ajustarStock(
    tenantId: string,
    usuarioId: string,
    itemId: string,
    dto: AjusteStockDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const itemRows: { tipo: string }[] = await manager.query(
        `SELECT tipo FROM items
         WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      if (!itemRows.length) throw new NotFoundException('Item no encontrado');
      if (itemRows[0].tipo !== 'producto') {
        throw new BadRequestException('El item no es un producto');
      }

      const { stockResultante } =
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId,
          usuarioId,
          tipo: dto.tipo,
          motivo: dto.motivo,
          cantidad: new Decimal(dto.cantidad).toString(),
          comentario: dto.comentario ?? null,
        });

      return { stock: stockResultante };
    });
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async validarMoneda(
    manager: EntityManager,
    tenantId: string,
    monedaId: string,
  ): Promise<void> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM pais_moneda pm
       JOIN provincia prov ON prov.pais_id = pm.pais_id AND prov.eliminado_el IS NULL
       JOIN tenants t ON t.provincia_id = prov.provincia_id AND t.eliminado_el IS NULL
       WHERE t.tenant_id = $1 AND pm.moneda_id = $2 AND pm.eliminado_el IS NULL`,
      [tenantId, monedaId],
    );
    if (!rows.length) {
      throw new BadRequestException(
        'La moneda no está disponible para este tenant',
      );
    }
  }

  private async validarCategoria(
    manager: EntityManager,
    tenantId: string,
    categoriaId: string,
  ): Promise<void> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM categorias
       WHERE categoria_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [categoriaId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('La categoría no pertenece a este tenant');
    }
  }

  private async validarReglas(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
    tabla: string,
    pkCol: string,
  ): Promise<void> {
    const rows: { cnt: string }[] = await manager.query(
      `SELECT COUNT(*) AS cnt FROM ${tabla}
       WHERE ${pkCol} = ANY($1::uuid[]) AND tenant_id = $2 AND eliminado_el IS NULL`,
      [ids, tenantId],
    );
    if (parseInt(rows[0].cnt) !== ids.length) {
      throw new BadRequestException(
        `Una o más reglas de ${tabla} no pertenecen a este tenant`,
      );
    }
  }

  private async insertarRelaciones(
    manager: EntityManager,
    itemId: string,
    impuestosIds: string[],
    recargosIds: string[],
    descuentosIds: string[],
  ): Promise<void> {
    for (const id of impuestosIds) {
      await manager.query(
        `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
    for (const id of recargosIds) {
      await manager.query(
        `INSERT INTO item_recargos (item_id, recargo_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
    for (const id of descuentosIds) {
      await manager.query(
        `INSERT INTO item_descuentos (item_id, descuento_id) VALUES ($1,$2)`,
        [itemId, id],
      );
    }
  }
}
