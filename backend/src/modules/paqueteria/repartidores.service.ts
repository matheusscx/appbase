import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CreateRepartidorDto } from './dto/create-repartidor.dto';
import { UpdateRepartidorDto } from './dto/update-repartidor.dto';
import type { RepartidorFila } from './paqueteria.types';

interface RepartidorRow {
  repartidor_id: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
}

const COLUMNAS = 'repartidor_id, nombre, telefono, activo';

const aFila = (r: RepartidorRow): RepartidorFila => ({
  id: r.repartidor_id,
  nombre: r.nombre,
  telefono: r.telefono,
  activo: r.activo,
});

@Injectable()
export class RepartidoresService {
  constructor(private readonly db: Db) {}

  /** Activos e inactivos: la pantalla de administración necesita ver al inactivo para reactivarlo. */
  async findAll(tenantId: string): Promise<RepartidorFila[]> {
    const rows: RepartidorRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM repartidores
        WHERE tenant_id = $1 AND eliminado_el IS NULL
        ORDER BY nombre`,
      [tenantId],
    );
    return rows.map(aFila);
  }

  async create(
    tenantId: string,
    dto: CreateRepartidorDto,
  ): Promise<RepartidorFila> {
    const rows = unwrap<RepartidorRow>(
      await this.db.query(
        `INSERT INTO repartidores (tenant_id, nombre, telefono)
         VALUES ($1, $2, $3)
         RETURNING ${COLUMNAS}`,
        [tenantId, dto.nombre, dto.telefono ?? null],
      ),
    );
    return aFila(rows[0]);
  }

  /** Solo toca lo que llegó: `telefono: null` lo borra, ausente lo deja como está. */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateRepartidorDto,
  ): Promise<RepartidorFila> {
    const sets: string[] = [];
    const params: unknown[] = [id, tenantId];
    const poner = (columna: string, valor: unknown) => {
      params.push(valor);
      sets.push(`${columna} = $${params.length}`);
    };
    if (dto.nombre !== undefined) poner('nombre', dto.nombre);
    if (dto.telefono !== undefined) poner('telefono', dto.telefono);
    if (dto.activo !== undefined) poner('activo', dto.activo);

    if (sets.length === 0) return this.buscar(tenantId, id);

    const rows = unwrap<RepartidorRow>(
      await this.db.query(
        `UPDATE repartidores SET ${sets.join(', ')}, actualizado_el = now()
          WHERE repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
          RETURNING ${COLUMNAS}`,
        params,
      ),
    );
    if (!rows.length) throw new NotFoundException('Repartidor no encontrado');
    return aFila(rows[0]);
  }

  /**
   * Una hoja de ruta nunca apunta a un repartidor borrado: con hojas se
   * desactiva (`activo = false`), no se elimina.
   */
  async remove(tenantId: string, id: string): Promise<{ success: true }> {
    return this.db.transaccion(async () => {
      const existe: { repartidor_id: string }[] = await this.db.query(
        `SELECT repartidor_id FROM repartidores
          WHERE repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
          FOR UPDATE`,
        [id, tenantId],
      );
      if (!existe.length)
        throw new NotFoundException('Repartidor no encontrado');

      const hojas: { tiene: boolean }[] = await this.db.query(
        `SELECT EXISTS (
           SELECT 1 FROM hojas_ruta
            WHERE repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
         ) AS tiene`,
        [id, tenantId],
      );
      if (hojas[0].tiene) {
        throw new BadRequestException(
          'El repartidor tiene hojas de ruta: desactivalo en vez de eliminarlo.',
        );
      }

      await this.db.query(
        `UPDATE repartidores SET eliminado_el = now(), actualizado_el = now()
          WHERE repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [id, tenantId],
      );
      return { success: true as const };
    });
  }

  /** Para quien asigna un paquete a un repartidor: lee `activo` aparte del `WHERE`, así "no es de este tenant" y "está inactivo" son errores distintos. */
  async exigirActivo(
    tenantId: string,
    repartidorId: string,
  ): Promise<RepartidorFila> {
    const fila = await this.buscar(tenantId, repartidorId);
    if (!fila.activo) {
      throw new BadRequestException(`${fila.nombre} está inactivo`);
    }
    return fila;
  }

  private async buscar(tenantId: string, id: string): Promise<RepartidorFila> {
    const rows: RepartidorRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM repartidores
        WHERE repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Repartidor no encontrado');
    return aFila(rows[0]);
  }
}
