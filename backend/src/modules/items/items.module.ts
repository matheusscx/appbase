import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { ItemSuscripcion } from './entities/item-suscripcion.entity';
import { ItemLote } from './entities/item-lote.entity';
import { ItemUnidad } from './entities/item-unidad.entity';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { InventarioModule } from '../inventario/inventario.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Item,
      ItemProducto,
      ItemServicio,
      ItemSuscripcion,
      ItemLote,
      ItemUnidad,
    ]),
    InventarioModule,
    CatalogModule,
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
