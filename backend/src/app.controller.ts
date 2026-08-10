import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Sin `@UseGuards`: el healthcheck de Railway pega sin credenciales. En este
  // proyecto los guards se aplican por controlador, así que esto es explícito
  // por omisión, no un olvido.
  @Get('health')
  verificarSalud(): Promise<{ estado: string; base: string }> {
    return this.appService.verificarSalud();
  }
}
