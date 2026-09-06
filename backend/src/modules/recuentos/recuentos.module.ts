import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MotivosDiferenciaInventarioModule } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.module';
import { InventarioModule } from '../inventario/inventario.module';
import { UbicacionesModule } from '../ubicaciones/ubicaciones.module';
import { RecuentoInventario } from './entities/recuento-inventario.entity';
import { RecuentoInventarioLinea } from './entities/recuento-inventario-linea.entity';
import { RecuentosService } from './recuentos.service';
import { RecuentosController } from './recuentos.controller';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      RecuentoInventario,
      RecuentoInventarioLinea,
    ]),
    MotivosDiferenciaInventarioModule,
    InventarioModule,
    // `registrarMovimiento` requiere `ubicacionId`: `create` resuelve el local
    // del tenant vía `UbicacionesService.localDe` una vez antes del loop de
    // líneas a aplicar.
    UbicacionesModule,
  ],
  controllers: [RecuentosController],
  providers: [RecuentosService],
  exports: [RecuentosService],
})
export class RecuentosModule {}
