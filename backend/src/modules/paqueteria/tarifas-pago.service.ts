import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CreateTarifaPagoDto } from './dto/create-tarifa-pago.dto';
import { UpdateTarifaPagoDto } from './dto/update-tarifa-pago.dto';
import type { TarifaPagoFila } from './paqueteria.types';

interface TarifaRow {
  tarifa_pago_id: string;
  nombre: string;
  monto: string;
  es_defecto: boolean;
  activa: boolean;
}

const COLUMNAS = 'tarifa_pago_id, nombre, monto, es_defecto, activa';

const aFila = (r: TarifaRow): TarifaPagoFila => ({
  id: r.tarifa_pago_id,
  nombre: r.nombre,
  monto: r.monto,
  esDefecto: r.es_defecto,
  activa: r.activa,
});

@Injectable()
export class TarifasPagoService {
  constructor(private readonly db: Db) {}

  /** Activas e inactivas: la pantalla de administración necesita ver la inactiva para reactivarla. */
  async listar(tenantId: string): Promise<TarifaPagoFila[]> {
    const rows: TarifaRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM tarifas_pago
        WHERE tenant_id = $1 AND eliminado_el IS NULL
        ORDER BY nombre`,
      [tenantId],
    );
    return rows.map(aFila);
  }

  async crear(
    tenantId: string,
    dto: CreateTarifaPagoDto,
  ): Promise<TarifaPagoFila> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const hay: { tiene: boolean }[] = await this.db.query(
        `SELECT EXISTS (
           SELECT 1 FROM tarifas_pago WHERE tenant_id = $1 AND eliminado_el IS NULL
         ) AS tiene`,
        [tenantId],
      );
      // La primera tarifa es la del defecto aunque no se pida: sin una por defecto no hay con qué pagar.
      const esDefecto = dto.esDefecto === true || !hay[0].tiene;
      if (esDefecto) await this.soltarDefecto(tenantId);
      const rows = await this.escribirConNombreUnico<unknown>(() =>
        this.db.query(
          `INSERT INTO tarifas_pago (tenant_id, nombre, monto, es_defecto)
           VALUES ($1, $2, $3, $4)
           RETURNING ${COLUMNAS}`,
          [tenantId, dto.nombre, dto.monto, esDefecto],
        ),
      );
      return aFila(unwrap<TarifaRow>(rows)[0]);
    });
  }

  /** Solo toca lo que llegó. `esDefecto: true` pasa el defecto a esta tarifa, en la misma transacción. */
  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateTarifaPagoDto,
  ): Promise<TarifaPagoFila> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const actual = await this.buscarBloqueada(tenantId, id);

      const activa = dto.activa ?? actual.activa;
      const esDefecto = dto.esDefecto ?? actual.es_defecto;
      if (actual.es_defecto && !esDefecto) {
        throw new BadRequestException(
          'Elegí otra tarifa por defecto antes de quitarle el defecto a esta.',
        );
      }
      if (actual.es_defecto && !activa) {
        throw new BadRequestException(
          'Elegí otra tarifa por defecto antes de desactivar esta.',
        );
      }
      if (esDefecto && !activa) {
        throw new BadRequestException(
          'La tarifa por defecto tiene que estar activa.',
        );
      }

      if (esDefecto && !actual.es_defecto) await this.soltarDefecto(tenantId);

      const rows = await this.escribirConNombreUnico<unknown>(() =>
        this.db.query(
          `UPDATE tarifas_pago
              SET nombre = $3, monto = $4, es_defecto = $5, activa = $6,
                  actualizado_el = now()
            WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
            RETURNING ${COLUMNAS}`,
          [
            id,
            tenantId,
            dto.nombre ?? actual.nombre,
            dto.monto ?? actual.monto,
            esDefecto,
            activa,
          ],
        ),
      );
      return aFila(unwrap<TarifaRow>(rows)[0]);
    });
  }

  /**
   * Soft delete. La por defecto no se borra, y una en uso por un repartidor o un paquete tampoco:
   * hay que desactivarla (sale de los selectores; las entregas ya marcadas guardan su monto).
   */
  async eliminar(tenantId: string, id: string): Promise<{ success: true }> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const actual = await this.buscarBloqueada(tenantId, id);
      if (actual.es_defecto) {
        throw new BadRequestException(
          'Elegí otra tarifa por defecto antes de eliminar esta.',
        );
      }
      const uso: { en_uso: boolean }[] = await this.db.query(
        `SELECT (
           EXISTS (SELECT 1 FROM repartidores
                    WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL)
           OR EXISTS (SELECT 1 FROM paquetes
                       WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL)
         ) AS en_uso`,
        [id, tenantId],
      );
      if (uso[0].en_uso) {
        throw new BadRequestException(
          'La tarifa está en uso por un repartidor o un paquete: desactivala en vez de eliminarla.',
        );
      }
      await this.db.query(
        `UPDATE tarifas_pago SET eliminado_el = now(), actualizado_el = now()
          WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [id, tenantId],
      );
      return { success: true as const };
    });
  }

  /**
   * Para quien asigna una tarifa (repartidor, paquete, escaneo): 400 si no existe, es de otro
   * tenant o está inactiva —los tres se ven igual desde afuera, no se filtra qué existe—. Con
   * `bloquear` (dentro de la transacción de quien escribe) la lee `FOR SHARE`: `eliminar` la toma
   * `FOR UPDATE` antes de mirar el uso, así que uno de los dos espera al otro.
   */
  async exigirActivaDelTenant(
    tenantId: string,
    id: string,
    { bloquear = false }: { bloquear?: boolean } = {},
  ): Promise<void> {
    const rows: { activa: boolean }[] = await this.db.query(
      `SELECT activa FROM tarifas_pago
        WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        ${bloquear ? 'FOR SHARE' : ''}`,
      [id, tenantId],
    );
    if (!rows.length || !rows[0].activa) {
      throw new BadRequestException(
        'La tarifa de pago no existe o está inactiva',
      );
    }
  }

  /** ¿Hay una tarifa por defecto viva? Sin ella no hay con qué pagar una entrega que no trae la suya. */
  async hayDefecto(tenantId: string): Promise<boolean> {
    const rows: { hay: boolean }[] = await this.db.query(
      `SELECT EXISTS (
         SELECT 1 FROM tarifas_pago
          WHERE tenant_id = $1 AND es_defecto AND eliminado_el IS NULL
       ) AS hay`,
      [tenantId],
    );
    return rows[0].hay;
  }

  /**
   * Para quien crea un paquete: sin ninguna tarifa cargada no se crean paquetes que se pagarían
   * $0. La por defecto no se borra ni se desactiva (`actualizar`, `eliminar`), así que si hay
   * alguna tarifa hay una por defecto y esta lectura sin cerrojo no se desactualiza.
   */
  async exigirDefecto(tenantId: string): Promise<void> {
    if (!(await this.hayDefecto(tenantId))) {
      throw new BadRequestException(
        'Cargá al menos una tarifa de pago (la primera queda por defecto) antes de cargar paquetes.',
      );
    }
  }

  /** Todas las escrituras del tenant en fila: el defecto único y la primera tarifa no admiten carrera. */
  private async serializar(tenantId: string): Promise<void> {
    await this.db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `tarifas_pago:${tenantId}`,
    ]);
  }

  private async soltarDefecto(tenantId: string): Promise<void> {
    await this.db.query(
      `UPDATE tarifas_pago SET es_defecto = false, actualizado_el = now()
        WHERE tenant_id = $1 AND es_defecto AND eliminado_el IS NULL`,
      [tenantId],
    );
  }

  private async buscarBloqueada(
    tenantId: string,
    id: string,
  ): Promise<TarifaRow> {
    const rows: TarifaRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM tarifas_pago
        WHERE tarifa_pago_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        FOR UPDATE`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Tarifa no encontrada');
    return rows[0];
  }

  /** El índice único frena el nombre repetido; la sentencia fallida deja la transacción abortada, así que se lanza sin tocar la base. */
  private async escribirConNombreUnico<T>(
    escribir: () => Promise<T>,
  ): Promise<T> {
    try {
      return await escribir();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ya existe una tarifa con ese nombre.');
      }
      throw e;
    }
  }
}
