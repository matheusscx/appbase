import { BadRequestException, Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { PutPaqueteConfiguracionDto } from './dto/put-paquete-configuracion.dto';
import type { PaqueteConfiguracionRespuesta } from './paqueteria.types';
import { TarifasPagoService } from './tarifas-pago.service';

interface ConfiguracionRow {
  precio_envio_defecto: string;
}

@Injectable()
export class PaqueteConfiguracionService {
  constructor(
    private readonly db: Db,
    private readonly tarifas: TarifasPagoService,
  ) {}

  private async leer(tenantId: string): Promise<ConfiguracionRow | undefined> {
    const rows: ConfiguracionRow[] = await this.db.query(
      `SELECT precio_envio_defecto
         FROM paquete_configuracion
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0];
  }

  /** Configurada = hay precio de envío por defecto Y una tarifa de pago por defecto. */
  async obtener(tenantId: string): Promise<PaqueteConfiguracionRespuesta> {
    const fila = await this.leer(tenantId);
    return {
      configurada: !!fila && (await this.tarifas.hayDefecto(tenantId)),
      precioEnvioDefecto: fila?.precio_envio_defecto ?? '0',
    };
  }

  /** El precio con el que se crea un paquete que no trae el suyo. Sin configurar no hay monto que inventar. */
  async exigirDefaults(tenantId: string): Promise<{ precioEnvio: string }> {
    const fila = await this.leer(tenantId);
    if (!fila) {
      throw new BadRequestException(
        'Configurá los valores por defecto de Paquetería antes de cargar paquetes.',
      );
    }
    return { precioEnvio: fila.precio_envio_defecto };
  }

  async guardar(
    tenantId: string,
    dto: PutPaqueteConfiguracionDto,
  ): Promise<PaqueteConfiguracionRespuesta> {
    const filas = await this.db.transaccion(async () =>
      unwrap<ConfiguracionRow>(
        await this.db.query(
          `INSERT INTO paquete_configuracion (tenant_id, precio_envio_defecto)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id) WHERE eliminado_el IS NULL
           DO UPDATE SET precio_envio_defecto = EXCLUDED.precio_envio_defecto,
                         actualizado_el = now()
           RETURNING precio_envio_defecto`,
          [tenantId, dto.precioEnvioDefecto],
        ),
      ),
    );
    return {
      configurada: await this.tarifas.hayDefecto(tenantId),
      precioEnvioDefecto: filas[0].precio_envio_defecto,
    };
  }
}
