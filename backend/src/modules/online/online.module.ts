import { Module } from '@nestjs/common';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { OnlineController } from './online.controller';
import { OnlineService } from './online.service';

@Module({
  imports: [CalculoPreciosModule],
  controllers: [OnlineController],
  providers: [OnlineService],
})
export class OnlineModule {}
