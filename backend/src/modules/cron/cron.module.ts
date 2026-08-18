import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { CronEjecucion } from './entities/cron-ejecucion.entity';
import { CronRunnerService } from './cron-runner.service';
import { ExpirarOrdenesJob } from './jobs/expirar-ordenes.job';

@Module({
  imports: [RepositoriosModule.forFeature([CronEjecucion])],
  providers: [CronRunnerService, ExpirarOrdenesJob],
  exports: [CronRunnerService],
})
export class CronModule {}
