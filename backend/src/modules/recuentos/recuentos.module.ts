import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MotivosDiferenciaInventarioModule } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.module';
import { InventarioModule } from '../inventario/inventario.module';
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
  ],
  controllers: [RecuentosController],
  providers: [RecuentosService],
  exports: [RecuentosService],
})
export class RecuentosModule {}
