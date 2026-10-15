import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { DteModule } from '../dte/dte.module';
import { EmisionBoletaController } from './emision-boleta.controller';
import { EmisionBoletaService } from './emision-boleta.service';
import { VentaDocumento } from './entities/venta-documento.entity';
import { VentaDocumentosService } from './venta-documentos.service';

/**
 * Módulo hoja: lo importan `VentasModule` y (desde la tarea 5) `PagosModule`, y
 * **no importa a ninguno de los dos**. `PagosModule` es dependencia de
 * `VentasModule`, así que el servicio no puede vivir en ventas; y ponerlo en
 * pagos haría de pagos el dueño de una tabla de ventas. Sin `forwardRef`.
 *
 * Importa `DteModule` (la emisión de la boleta usa sus folios, su cola y su perfil): `dte` no
 * importa nada de ventas ni de pagos, así que no se forma un ciclo.
 */
@Module({
  imports: [RepositoriosModule.forFeature([VentaDocumento]), DteModule],
  controllers: [EmisionBoletaController],
  providers: [VentaDocumentosService, EmisionBoletaService],
  exports: [VentaDocumentosService, EmisionBoletaService],
})
export class VentaDocumentosModule {}
