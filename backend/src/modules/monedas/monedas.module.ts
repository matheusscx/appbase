import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantMoneda } from './entities/tenant-moneda.entity';
import { PaisMoneda } from './entities/pais-moneda.entity';
import { MonedasService } from './monedas.service';
import { MonedasController } from './monedas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TenantMoneda, PaisMoneda])],
  controllers: [MonedasController],
  providers: [MonedasService],
  exports: [MonedasService],
})
export class MonedasModule {}
