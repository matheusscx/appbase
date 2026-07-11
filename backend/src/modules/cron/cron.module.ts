import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';
import { CronRunnerService } from './cron-runner.service';
import { ExpirarOrdenesJob } from './jobs/expirar-ordenes.job';

@Module({
  imports: [TypeOrmModule.forFeature([CronEjecucion])],
  providers: [CronRunnerService, ExpirarOrdenesJob],
  exports: [CronRunnerService],
})
export class CronModule {}
