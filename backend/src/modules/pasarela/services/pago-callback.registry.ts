import { Injectable } from '@nestjs/common';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';

/**
 * Contrato del callback in-process del monolito. Un módulo de negocio (p. ej.
 * `online`) lo implementa para materializar su lado cuando una orden se resuelve
 * (crear la venta al quedar `pagada`). Mantiene el borde: la pasarela NO importa
 * los módulos de negocio; ellos se registran contra esta interfaz.
 */
export interface PagoCallbackHandler {
  onOrdenResuelta(orden: PasarelaOrden): Promise<void>;
}

/**
 * Registro singleton del handler de callback in-process. Alternativa liviana a
 * un event bus (`@nestjs/event-emitter` no está instalado): un único handler
 * por proceso, registrado en el `onModuleInit` del módulo consumidor.
 */
@Injectable()
export class PagoCallbackRegistry {
  private handler: PagoCallbackHandler | null = null;

  register(handler: PagoCallbackHandler): void {
    this.handler = handler;
  }

  get(): PagoCallbackHandler | null {
    return this.handler;
  }
}
