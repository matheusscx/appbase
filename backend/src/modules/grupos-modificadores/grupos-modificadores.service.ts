import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import {
  CreateGrupoModificadorDto,
  GrupoOpcionInputDto,
} from './dto/create-grupo-modificador.dto';
import { CatalogService } from '../catalog/catalog.service';

export type FamiliaEfecto = 'ingrediente' | 'vendible';

export interface OpcionResuelta {
  itemId: string;
  itemNombre: string;
  tipo: string;
  cantidad: string;
  unidadCodigo: string | null;
  precioExtra: string;
  orden: number;
}

@Injectable()
export class GruposModificadoresService {
  constructor(
    @InjectRepository(GrupoModificador)
    private readonly grupoRepo: Repository<GrupoModificador>,
    @InjectRepository(GrupoModificadorOpcion)
    private readonly opcionRepo: Repository<GrupoModificadorOpcion>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly catalogService: CatalogService,
  ) {}

  private familiaDeTipo(tipo: string): FamiliaEfecto {
    return tipo === 'ingrediente' ? 'ingrediente' : 'vendible';
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
    let orden = 0;
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
      if (new Decimal(op.cantidad).lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'La cantidad de la opción debe ser mayor a 0',
        );
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
        if (!op.unidadCodigo) {
          throw new BadRequestException(
            'Las opciones ingrediente requieren unidad de medida',
          );
        }
        // Verifica magnitud/convertibilidad contra la unidad base del ingrediente.
        await this.catalogService.convertirUnidad(
          op.cantidad,
          op.unidadCodigo,
          unidad_medida!,
        );
        unidadCodigo = op.unidadCodigo;
      }

      const resuelta: OpcionResuelta = {
        itemId: op.itemId,
        itemNombre: nombre,
        tipo,
        cantidad: op.cantidad,
        unidadCodigo,
        precioExtra: op.precioExtra,
        orden: op.orden ?? orden,
      };
      if (onResuelto) {
        await onResuelto(resuelta);
      }
      resueltas.push(resuelta);
      orden++;
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
      };
    });
  }
}
