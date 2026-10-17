import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CreateTarifaEnvioDto } from './dto/create-tarifa-envio.dto';
import { UpdateTarifaEnvioDto } from './dto/update-tarifa-envio.dto';
import type { TarifaEnvioFila } from './paqueteria.types';

interface TarifaRow {
  tarifa_envio_id: string;
  nombre: string;
  monto: string;
  es_defecto: boolean;
  activa: boolean;
}

const COLUMNAS = 'tarifa_envio_id, nombre, monto, es_defecto, activa';

const aFila = (r: TarifaRow): TarifaEnvioFila => ({
  id: r.tarifa_envio_id,
  nombre: r.nombre,
  monto: r.monto,
  esDefecto: r.es_defecto,
  activa: r.activa,
});

@Injectable()
export class TarifasEnvioService {
  constructor(private readonly db: Db) {}

  /** Activas e inactivas: la pantalla de administración necesita ver la inactiva para reactivarla. */
  async listar(tenantId: string): Promise<TarifaEnvioFila[]> {
    const rows: TarifaRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM tarifas_envio
        WHERE tenant_id = $1 AND eliminado_el IS NULL
        ORDER BY nombre`,
      [tenantId],
    );
    return rows.map(aFila);
  }

  async crear(
    tenantId: string,
    dto: CreateTarifaEnvioDto,
  ): Promise<TarifaEnvioFila> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const hay: { tiene: boolean }[] = await this.db.query(
        `SELECT EXISTS (
           SELECT 1 FROM tarifas_envio WHERE tenant_id = $1 AND eliminado_el IS NULL
         ) AS tiene`,
        [tenantId],
      );
      // La primera tarifa es la del defecto aunque no se pida: sin una por defecto no hay con qué cobrar el envío.
      const esDefecto = dto.esDefecto === true || !hay[0].tiene;
      if (esDefecto) await this.soltarDefecto(tenantId);
      const rows = await this.escribirConNombreUnico<unknown>(() =>
        this.db.query(
          `INSERT INTO tarifas_envio (tenant_id, nombre, monto, es_defecto)
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
    dto: UpdateTarifaEnvioDto,
  ): Promise<TarifaEnvioFila> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const actual = await this.buscarBloqueada(tenantId, id);

      const activa = dto.activa ?? actual.activa;
      const esDefecto = dto.esDefecto ?? actual.es_defecto;
      if (actual.es_defecto && !esDefecto) {
        throw new BadRequestException(
          'Elige otra tarifa por defecto antes de quitarle el defecto a esta.',
        );
      }
      if (actual.es_defecto && !activa) {
        throw new BadRequestException(
          'Elige otra tarifa por defecto antes de desactivar esta.',
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
          `UPDATE tarifas_envio
              SET nombre = $3, monto = $4, es_defecto = $5, activa = $6,
                  actualizado_el = now()
            WHERE tarifa_envio_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
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
   * Soft delete. La por defecto no se borra, y una en uso por un paquete tampoco: hay que
   * desactivarla (sale de los selectores; las entregas ya marcadas guardan su precio).
   *
   * Solo se cuentan los PAQUETES, no las líneas de hoja (`hoja_ruta_paquetes.tarifa_envio_id`),
   * igual que `tarifas_pago`: la FK no frena un soft delete, y la línea no depende de la tarifa
   * (copió su precio al entregar; el nombre se lee sin filtro de borrado a propósito). Contar las
   * líneas dejaría sin borrar para siempre toda tarifa que alguna vez cobró una entrega.
   */
  async eliminar(tenantId: string, id: string): Promise<{ success: true }> {
    return this.db.transaccion(async () => {
      await this.serializar(tenantId);
      const actual = await this.buscarBloqueada(tenantId, id);
      if (actual.es_defecto) {
        throw new BadRequestException(
          'Elige otra tarifa por defecto antes de eliminar esta.',
        );
      }
      const uso: { en_uso: boolean }[] = await this.db.query(
        `SELECT EXISTS (SELECT 1 FROM paquetes
                         WHERE tarifa_envio_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL)
                AS en_uso`,
        [id, tenantId],
      );
      if (uso[0].en_uso) {
        throw new BadRequestException(
          'La tarifa está en uso por un paquete: desactívala en vez de eliminarla.',
        );
      }
      await this.db.query(
        `UPDATE tarifas_envio SET eliminado_el = now(), actualizado_el = now()
          WHERE tarifa_envio_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [id, tenantId],
      );
      return { success: true as const };
    });
  }

  /**
   * Para quien asigna una tarifa (paquete, escaneo): 400 si no existe, es de otro
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
      `SELECT activa FROM tarifas_envio
        WHERE tarifa_envio_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        ${bloquear ? 'FOR SHARE' : ''}`,
      [id, tenantId],
    );
    if (!rows.length || !rows[0].activa) {
      throw new BadRequestException(
        'La tarifa de envío no existe o está inactiva',
      );
    }
  }

  /**
   * Para quien crea un paquete sin tarifa de envío propia: sin una por defecto no hay con qué
   * cobrar el envío y se crearía un paquete que se entrega a $0. La por defecto no se borra ni se
   * desactiva (`actualizar`, `eliminar`), así que si hay alguna tarifa hay una por defecto y esta
   * lectura sin cerrojo no se desactualiza.
   */
  async exigirDefecto(tenantId: string): Promise<void> {
    const rows: { hay: boolean }[] = await this.db.query(
      `SELECT EXISTS (
         SELECT 1 FROM tarifas_envio
          WHERE tenant_id = $1 AND es_defecto AND eliminado_el IS NULL
       ) AS hay`,
      [tenantId],
    );
    if (!rows[0].hay) {
      throw new BadRequestException(
        'Carga una tarifa de envío por defecto en Configuración → Paquetería antes de cargar paquetes.',
      );
    }
  }

  /** Todas las escrituras del tenant en fila: el defecto único y la primera tarifa no admiten carrera. */
  private async serializar(tenantId: string): Promise<void> {
    await this.db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `tarifas_envio:${tenantId}`,
    ]);
  }

  private async soltarDefecto(tenantId: string): Promise<void> {
    await this.db.query(
      `UPDATE tarifas_envio SET es_defecto = false, actualizado_el = now()
        WHERE tenant_id = $1 AND es_defecto AND eliminado_el IS NULL`,
      [tenantId],
    );
  }

  private async buscarBloqueada(
    tenantId: string,
    id: string,
  ): Promise<TarifaRow> {
    const rows: TarifaRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM tarifas_envio
        WHERE tarifa_envio_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
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
