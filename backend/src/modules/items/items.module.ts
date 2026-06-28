import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { ItemLote } from './entities/item-lote.entity';
import { ItemUnidad } from './entities/item-unidad.entity';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { InventarioModule } from '../inventario/inventario.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Item,
      ItemProducto,
      ItemServicio,
      ItemLote,
      ItemUnidad,
    ]),
    InventarioModule,
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
