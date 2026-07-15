import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CausaMerma } from './entities/causa-merma.entity';
import { CausasMermaService } from './causas-merma.service';
import { CausasMermaController } from './causas-merma.controller';
import { InventarioModule } from '../inventario/inventario.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CausaMerma]),
    InventarioModule,
    CatalogModule,
  ],
  controllers: [CausasMermaController],
  providers: [CausasMermaService],
  exports: [CausasMermaService],
})
export class MermasModule {}
