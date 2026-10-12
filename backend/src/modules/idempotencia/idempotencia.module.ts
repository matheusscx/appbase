import { Module } from '@nestjs/common';
import { IdempotenciaService } from './idempotencia.service';

/**
 * Sin `RepositoriosModule.forFeature`: el servicio escribe por `Db.query`
 * (que es global), no por repositorio. La entidad igual va en `ENTIDADES`
 * (`src/database/typeorm.config.ts`), que es de donde sale su migración y lo que
 * hace que TypeORM la conozca.
 */
@Module({
  providers: [IdempotenciaService],
  exports: [IdempotenciaService],
})
export class IdempotenciaModule {}
