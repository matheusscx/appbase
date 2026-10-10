import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { PagoCallbackRegistry } from './pago-callback.registry';

/**
 * Notifica a la app consumidora que una orden se resolvió, para que materialice
 * su lado (crear la venta), y marca la orden `conciliada` cuando la app confirma.
 *
 * - `interno` (monolito): llama in-process al handler registrado y espera (await).
 *   Al volver OK la venta ya existe → orden `conciliada` antes del redirect.
 * - `http` (apps externas): POST {ordenId} a la urlCallback, fire-and-forget (no
 *   detiene el redirect); al recibir 2xx marca `conciliada`.
 *
 * Un error del callback interno nunca rompe el retorno: la orden queda `pagada`
 * sin venta, con el motivo en `motivo_sin_venta`. Con eso el comprador recibe un
 * estado propio y el admin la encuentra en `/ordenes` (pendientes.md § 3, D).
 * Nada la convierte en venta después, sola: no hay reintento automático.
 */
@Injectable()
export class CallbackDispatcherService {
  private readonly logger = new Logger(CallbackDispatcherService.name);

  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly registry: PagoCallbackRegistry,
  ) {}

  /** Se invoca tras resolver la orden. Solo concilia el camino pagado. */
  async dispatch(orden: PasarelaOrden): Promise<void> {
    if (orden.estado !== 'pagada') return; // fallida/pendiente: nada que materializar en v1

    const callbackModo =
      typeof orden.metadata?.callbackModo === 'string'
        ? orden.metadata.callbackModo
        : 'http';

    if (callbackModo === 'interno') {
      await this.dispatchInterno(orden);
    } else {
      this.dispatchHttp(orden);
    }
  }

  private async dispatchInterno(orden: PasarelaOrden): Promise<void> {
    const handler = this.registry.get();
    if (!handler) {
      this.logger.warn(
        `Orden ${orden.ordenId} con callback interno pero sin handler registrado`,
      );
      return;
    }
    try {
      await handler.onOrdenResuelta(orden); // el handler setea orden.ventaId
      orden.estado = 'conciliada';
      await this.ordenRepo.save(orden);
    } catch (e) {
      // No romper el redirect: la orden queda `pagada` sin venta. El detalle
      // técnico va al log; a la orden, solo lo que el admin puede leer.
      this.logger.error(
        `Callback interno falló para orden ${orden.ordenId}: ${String(e)}`,
      );
      orden.motivoSinVenta = motivoLegible(e);
      try {
        await this.ordenRepo.save(orden);
      } catch (eGuardar) {
        this.logger.error(
          `No se pudo guardar el motivo sin venta de la orden ${orden.ordenId}: ${String(eGuardar)}`,
        );
      }
    }
  }

  private dispatchHttp(orden: PasarelaOrden): void {
    const urls = (orden.metadata?.urls ?? {}) as Record<string, string>;
    const url = urls.callback;
    if (!url) return;
    // Fire-and-forget: no bloquea el redirect del usuario.
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ordenId: orden.ordenId }),
    })
      .then(async (res) => {
        if (res.ok) {
          orden.estado = 'conciliada';
          await this.ordenRepo.save(orden);
        } else {
          this.logger.error(
            `Callback HTTP a ${url} respondió ${res.status} (orden ${orden.ordenId})`,
          );
        }
      })
      .catch((e: unknown) => {
        this.logger.error(
          `Callback HTTP a ${url} falló (orden ${orden.ordenId}): ${String(e)}`,
        );
      });
  }
}

const MOTIVO_GENERICO =
  'Error interno al registrar la venta; el detalle quedó en el log del servidor';

/**
 * El motivo que ve el admin. Un `HttpException` es un error de dominio con un
 * mensaje pensado para mostrarse: es el mismo 400 que ya devuelve la API.
 * Cualquier otro (`QueryFailedError`, un `TypeError`) puede llevar SQL o
 * nombres internos, así que queda el texto genérico y el detalle en el log.
 */
function motivoLegible(e: unknown): string {
  if (!(e instanceof HttpException)) return MOTIVO_GENERICO;
  const respuesta = e.getResponse();
  if (typeof respuesta === 'string') return respuesta;
  const mensaje = (respuesta as { message?: unknown }).message;
  if (Array.isArray(mensaje)) return mensaje.map(String).join('; ');
  return typeof mensaje === 'string' ? mensaje : e.message;
}
