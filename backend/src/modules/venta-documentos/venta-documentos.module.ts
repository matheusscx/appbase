import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { VentaDocumento } from './entities/venta-documento.entity';
import { VentaDocumentosService } from './venta-documentos.service';

/**
 * Módulo hoja: lo importan `VentasModule` y (desde la tarea 5) `PagosModule`, y
 * **no importa a ninguno de los dos**. `PagosModule` es dependencia de
 * `VentasModule`, así que el servicio no puede vivir en ventas; y ponerlo en
 * pagos haría de pagos el dueño de una tabla de ventas. Sin `forwardRef`.
 */
@Module({
  imports: [RepositoriosModule.forFeature([VentaDocumento])],
  providers: [VentaDocumentosService],
  exports: [VentaDocumentosService],
})
export class VentaDocumentosModule {}
