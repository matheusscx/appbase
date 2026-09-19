import { Module } from '@nestjs/common';
import { IdempotenciaService } from './idempotencia.service';

/**
 * Sin `RepositoriosModule.forFeature`: el servicio escribe por `Db.query`
 * (que es global), no por repositorio. La entidad igual va en el array
 * `entities` de `app.module.ts`, que es lo que hace que `synchronize` cree la
 * tabla.
 */
@Module({
  providers: [IdempotenciaService],
  exports: [IdempotenciaService],
})
export class IdempotenciaModule {}
