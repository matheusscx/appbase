import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CronRunnerService } from '../cron-runner.service';

export const JOB_EXPIRAR_ORDENES = 'expirar-ordenes';

/**
 * Expira órdenes de pasarela vencidas según su fecha_expiracion (fijada al
 * crear la orden; hoy creación + 2 h). Replica la regla de la expiración
 * perezosa de cobros.service.ts: nunca expira una orden con un intento de
 * autorización en error — pudo haberse pagado en el proveedor y se cierra
 * solo vía /verificar. La vía perezosa se mantiene; ambas son idempotentes.
 */
@Injectable()
export class ExpirarOrdenesJob implements OnApplicationBootstrap {
  constructor(
    private readonly runner: CronRunnerService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // Tick inicial al arrancar: limpia el backlog acumulado si el backend
  // estuvo caído (y permite verificar el job sin esperar el próximo tick).
  onApplicationBootstrap(): Promise<void> {
    return this.tick();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  tick(): Promise<void> {
    return this.runner.ejecutar(JOB_EXPIRAR_ORDENES, () =>
      this.expirarOrdenesVencidas(),
    );
  }

  async expirarOrdenesVencidas(): Promise<string> {
    // pg: UPDATE vía dataSource.query devuelve [rows, rowCount]
    const resultado = (await this.dataSource.query(
      `UPDATE pasarela_ordenes o
       SET estado = 'expirada', actualizado_el = now()
       WHERE o.estado IN ('creada', 'en_proceso')
         AND o.eliminado_el IS NULL
         AND o.fecha_expiracion IS NOT NULL
         AND o.fecha_expiracion < now()
         AND NOT EXISTS (
           SELECT 1 FROM pasarela_transacciones t
           WHERE t.orden_id = o.orden_id
             AND t.tipo = 'AUTHORIZATION'
             AND t.estado = 'error'
             AND t.eliminado_el IS NULL
         )`,
    )) as [unknown[], number];
    const cantidad = resultado[1];
    return `${cantidad} órdenes expiradas`;
  }
}
