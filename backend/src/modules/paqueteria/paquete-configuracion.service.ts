import { BadRequestException, Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { PutPaqueteConfiguracionDto } from './dto/put-paquete-configuracion.dto';
import type { PaqueteConfiguracionRespuesta } from './paqueteria.types';

interface ConfiguracionRow {
  precio_envio_defecto: string;
  pago_repartidor_defecto: string;
}

@Injectable()
export class PaqueteConfiguracionService {
  constructor(private readonly db: Db) {}

  private async leer(tenantId: string): Promise<ConfiguracionRow | undefined> {
    const rows: ConfiguracionRow[] = await this.db.query(
      `SELECT precio_envio_defecto, pago_repartidor_defecto
         FROM paquete_configuracion
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0];
  }

  async obtener(tenantId: string): Promise<PaqueteConfiguracionRespuesta> {
    const fila = await this.leer(tenantId);
    if (!fila) {
      return {
        configurada: false,
        precioEnvioDefecto: '0',
        pagoRepartidorDefecto: '0',
      };
    }
    return {
      configurada: true,
      precioEnvioDefecto: fila.precio_envio_defecto,
      pagoRepartidorDefecto: fila.pago_repartidor_defecto,
    };
  }

  /** Los montos con los que se crea un paquete que no trae los suyos. Sin configurar no hay montos que inventar. */
  async exigirDefaults(
    tenantId: string,
  ): Promise<{ precioEnvio: string; pagoRepartidor: string }> {
    const fila = await this.leer(tenantId);
    if (!fila) {
      throw new BadRequestException(
        'Configurá los valores por defecto de Paquetería antes de cargar paquetes.',
      );
    }
    return {
      precioEnvio: fila.precio_envio_defecto,
      pagoRepartidor: fila.pago_repartidor_defecto,
    };
  }

  async guardar(
    tenantId: string,
    dto: PutPaqueteConfiguracionDto,
  ): Promise<PaqueteConfiguracionRespuesta> {
    const filas = await this.db.transaccion(async () =>
      unwrap<ConfiguracionRow>(
        await this.db.query(
          `INSERT INTO paquete_configuracion
             (tenant_id, precio_envio_defecto, pago_repartidor_defecto)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id) WHERE eliminado_el IS NULL
           DO UPDATE SET precio_envio_defecto = EXCLUDED.precio_envio_defecto,
                         pago_repartidor_defecto = EXCLUDED.pago_repartidor_defecto,
                         actualizado_el = now()
           RETURNING precio_envio_defecto, pago_repartidor_defecto`,
          [tenantId, dto.precioEnvioDefecto, dto.pagoRepartidorDefecto],
        ),
      ),
    );
    return {
      configurada: true,
      precioEnvioDefecto: filas[0].precio_envio_defecto,
      pagoRepartidorDefecto: filas[0].pago_repartidor_defecto,
    };
  }
}
