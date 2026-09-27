import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CatalogService } from '../catalog/catalog.service';
import type {
  CrearPresentacionCompraDto,
  EditarPresentacionCompraDto,
} from './dto/presentacion-compra.dto';

/**
 * Los tipos de ítem que llevan stock: los dos que tienen `item_producto`. Es
 * la misma pareja que aceptan mermas y el ajuste de stock
 * (`docs/features/tipo-ingrediente.md`). Vive acá y no en `compras.service.ts`
 * (donde nació) porque `ComprasService` va a importar `PresentacionesCompraService`
 * en la Tarea 2 (validar la línea, el helper de cantidad base) — si la
 * constante siguiera del otro lado, ese import sería circular.
 */
export const TIPOS_CON_STOCK = ['producto', 'ingrediente'];

/** Lo que ve el selector: una presentación viva, con su etiqueta armada afuera. */
export interface PresentacionCompraVista {
  id: string;
  proveedorId: string;
  itemId: string;
  nombre: string;
  contenido: string;
  unidadCodigo: string;
}

/** Lo que el borrador necesita de una presentación viva. */
export interface PresentacionViva {
  id: string;
  proveedorId: string;
  itemId: string;
  nombre: string;
  contenido: string;
  unidadCodigo: string;
}

interface PresentacionRow {
  presentacion_compra_id: string;
  proveedor_id: string;
  item_id: string;
  nombre: string;
  contenido: string;
  unidad_codigo: string;
}

const COLUMNAS =
  'presentacion_compra_id, proveedor_id, item_id, nombre, contenido, unidad_codigo';

function vista(r: PresentacionRow): PresentacionCompraVista {
  return {
    id: r.presentacion_compra_id,
    proveedorId: r.proveedor_id,
    itemId: r.item_id,
    nombre: r.nombre,
    contenido: r.contenido,
    unidadCodigo: r.unidad_codigo,
  };
}

/**
 * Cómo le viene un producto a un proveedor: "Caja" de 12 unidad, "Saco" de 25
 * kg (spec compras-unidad-de-compra § 3.1 y § 5). Por (proveedor, producto):
 * otro proveedor puede traerlo en pack de 6 (owner, decisión 4b).
 *
 * Se crean, corrigen y retiran en plena carga del borrador — es operación del
 * módulo `Compras:Crear`, no configuración del admin del tenant.
 */
@Injectable()
export class PresentacionesCompraService {
  constructor(
    private readonly db: Db,
    private readonly catalogService: CatalogService,
  ) {}

  async listar(
    tenantId: string,
    proveedorId: string,
  ): Promise<PresentacionCompraVista[]> {
    const rows: PresentacionRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM presentaciones_compra
        WHERE tenant_id = $1 AND proveedor_id = $2 AND eliminado_el IS NULL
        ORDER BY item_id, lower(nombre)`,
      [tenantId, proveedorId],
    );
    return rows.map(vista);
  }

  async crear(
    tenantId: string,
    dto: CrearPresentacionCompraDto,
  ): Promise<PresentacionCompraVista> {
    await this.assertProveedor(tenantId, dto.proveedorId);
    await this.assertProductoYContenido(
      tenantId,
      dto.itemId,
      dto.contenido,
      dto.unidadCodigo,
    );
    const rows = unwrap<PresentacionRow>(
      await this.conNombreUnico(() =>
        this.db.query(
          `INSERT INTO presentaciones_compra (tenant_id, proveedor_id, item_id, nombre, contenido, unidad_codigo)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS}`,
          [
            tenantId,
            dto.proveedorId,
            dto.itemId,
            dto.nombre,
            dto.contenido,
            dto.unidadCodigo,
          ],
        ),
      ),
    );
    return vista(rows[0]);
  }

  async editar(
    tenantId: string,
    id: string,
    dto: EditarPresentacionCompraDto,
  ): Promise<PresentacionCompraVista> {
    const actual = await this.vivaOrFail(tenantId, id);
    const nueva = {
      nombre: dto.nombre ?? actual.nombre,
      contenido: dto.contenido ?? actual.contenido,
      unidadCodigo: dto.unidadCodigo ?? actual.unidad_codigo,
    };
    await this.assertProductoYContenido(
      tenantId,
      actual.item_id,
      nueva.contenido,
      nueva.unidadCodigo,
    );
    const rows = unwrap<PresentacionRow>(
      await this.conNombreUnico(() =>
        this.db.query(
          `UPDATE presentaciones_compra
              SET nombre = $3, contenido = $4, unidad_codigo = $5, actualizado_el = NOW()
            WHERE tenant_id = $1 AND presentacion_compra_id = $2 AND eliminado_el IS NULL
            RETURNING ${COLUMNAS}`,
          [tenantId, id, nueva.nombre, nueva.contenido, nueva.unidadCodigo],
        ),
      ),
    );
    // Carrera: otra request la retiró entre el `vivaOrFail` de arriba y este
    // UPDATE. Sin este chequeo, `vista(rows[0])` revienta con 500 en vez del
    // 404 que el caso merece.
    if (!rows.length) {
      throw new NotFoundException('Presentación no encontrada');
    }
    return vista(rows[0]);
  }

  /** Retirar es marcar: las compras confirmadas ya congelaron su contenido. */
  async retirar(tenantId: string, id: string): Promise<void> {
    const rows = unwrap<{ presentacion_compra_id: string }>(
      await this.db.query(
        `UPDATE presentaciones_compra SET eliminado_el = NOW(), actualizado_el = NOW()
          WHERE tenant_id = $1 AND presentacion_compra_id = $2 AND eliminado_el IS NULL
          RETURNING presentacion_compra_id`,
        [tenantId, id],
      ),
    );
    if (!rows.length) throw new NotFoundException('Presentación no encontrada');
  }

  /** Las vivas del tenant entre `ids`, en UNA consulta. Las que faltan no están en el mapa. */
  async vivasPorIds(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, PresentacionViva>> {
    if (!ids.length) return new Map();
    const rows: PresentacionRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM presentaciones_compra
        WHERE tenant_id = $1 AND presentacion_compra_id = ANY($2::uuid[]) AND eliminado_el IS NULL`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.presentacion_compra_id, vista(r)]));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validaciones
  // ───────────────────────────────────────────────────────────────────────

  private async assertProveedor(
    tenantId: string,
    proveedorId: string,
  ): Promise<void> {
    const rows: { nombre: string; tipo: string }[] = await this.db.query(
      `SELECT nombre, tipo FROM terceros
        WHERE tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [proveedorId, tenantId],
    );
    // Mismo mensaje para "no existe" y "es de otro tenant" que
    // `ComprasService.validarEncabezado`: un id ajeno tiene que ser
    // indistinguible de uno inexistente.
    if (!rows.length) {
      throw new BadRequestException('Proveedor no encontrado');
    }
    if (rows[0].tipo !== 'proveedor') {
      throw new BadRequestException(`"${rows[0].nombre}" no es un proveedor`);
    }
  }

  private async assertProductoYContenido(
    tenantId: string,
    itemId: string,
    contenido: string,
    unidadCodigo: string,
  ): Promise<void> {
    const rows: {
      nombre: string;
      tipo: string;
      modo_inventario: string | null;
      unidad_medida: string | null;
    }[] = await this.db.query(
      `SELECT i.nombre, i.tipo, ip.modo_inventario, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
        WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('Producto no encontrado');
    }
    const item = rows[0];
    if (!TIPOS_CON_STOCK.includes(item.tipo) || !item.modo_inventario) {
      throw new BadRequestException(`"${item.nombre}" no lleva stock`);
    }
    if (item.modo_inventario === 'serie') {
      throw new BadRequestException(
        `"${item.nombre}" va por serie: no admite presentación`,
      );
    }

    const base = item.unidad_medida ?? 'unidad';
    if (unidadCodigo !== base) {
      // Tira 400 propio si la unidad no existe, es de otra magnitud o la
      // cantidad convertida cae bajo la precisión de stock (catalog.service.ts).
      const convertir = await this.catalogService.crearConversor();
      convertir(contenido, unidadCodigo, base);
    }
  }

  private async vivaOrFail(
    tenantId: string,
    id: string,
  ): Promise<PresentacionRow> {
    const rows: PresentacionRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM presentaciones_compra
        WHERE tenant_id = $1 AND presentacion_compra_id = $2 AND eliminado_el IS NULL`,
      [tenantId, id],
    );
    if (!rows.length) {
      throw new NotFoundException('Presentación no encontrada');
    }
    return rows[0];
  }

  /** El patrón de `ComprasService.insertarSinChoqueDeFolio`, para el índice único de nombre. */
  private async conNombreUnico<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (
        e.code === '23505' &&
        e.constraint === 'uq_presentaciones_compra_nombre'
      ) {
        throw new ConflictException(
          'Ya hay una presentación con ese nombre para este producto y proveedor',
        );
      }
      throw error;
    }
  }
}
