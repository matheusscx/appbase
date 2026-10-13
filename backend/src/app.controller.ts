import { Controller, Get, Headers, Logger } from '@nestjs/common';
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
  // Medición de una sola vez (frente de rate limiting, 2026-10-13): qué cabeceras
  // de IP le entrega el borde de Railway a la app. Se saca en el commit siguiente.
  // Imprime esas dos cabeceras y nada más.
  @Get('health')
  verificarSalud(
    @Headers('x-real-ip') xRealIp?: string,
    @Headers('x-forwarded-for') xForwardedFor?: string,
  ): Promise<{ estado: string; base: string }> {
    new Logger('MedicionIp').log(
      `x-real-ip=${xRealIp ?? '-'} x-forwarded-for=${xForwardedFor ?? '-'}`,
    );
    return this.appService.verificarSalud();
  }
}
