import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { construirThrottlers } from './limites.config';
import { LimitesGuard } from './limites.guard';

/**
 * Límites de intentos para toda la API (ADR-032). Guard global: una ruta nueva
 * queda limitada sin que nadie se acuerde de pedirlo.
 *
 * El contador vive en la memoria del proceso. Alcanza mientras el backend sea
 * **una** réplica en **una** región (Railway, medido el 2026-10-13); con más,
 * cada copia cuenta por su lado y el límite real se multiplica. Ahí hace falta
 * un store compartido (Redis), que es pago y lo decide el owner: ADR-032.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: construirThrottlers(config),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: LimitesGuard }],
})
export class LimitesModule {}
