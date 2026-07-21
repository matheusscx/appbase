import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { ItemSuscripcion } from './entities/item-suscripcion.entity';
import { ItemReceta } from './entities/item-receta.entity';
import { RecetaIngrediente } from './entities/receta-ingrediente.entity';
import { RecetaExtraPermitido } from './entities/receta-extra-permitido.entity';
import { ItemLote } from './entities/item-lote.entity';
import { ItemUnidad } from './entities/item-unidad.entity';
import { ItemCombo } from './entities/item-combo.entity';
import { ComboComponente } from './entities/combo-componente.entity';
import { ItemGrupoModificador } from './entities/item-grupo-modificador.entity';
import { ItemGrupoModificadorOpcion } from './entities/item-grupo-modificador-opcion.entity';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { RecetasDesfasesController } from './recetas-desfases.controller';
import { InventarioModule } from '../inventario/inventario.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Item,
      ItemProducto,
      ItemServicio,
      ItemSuscripcion,
      ItemReceta,
      RecetaIngrediente,
      RecetaExtraPermitido,
      ItemLote,
      ItemUnidad,
      ItemCombo,
      ComboComponente,
      ItemGrupoModificador,
      ItemGrupoModificadorOpcion,
    ]),
    InventarioModule,
    CatalogModule,
  ],
  controllers: [ItemsController, RecetasDesfasesController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
