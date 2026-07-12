import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';

const PASARELA_TOKENIZADA = 'oneclick';

// Páginas de retorno permitidas tras inscribir una tarjeta (evita open-redirect):
// el flujo normal vuelve a "Mis medios de pago"; el alta de suscripción vuelve a
// "Mis suscripciones" para reanudar el cobro automáticamente.
const RETORNO_PATHS: Record<string, string> = {
  'medios-pago': '/tienda/medios-pago',
  suscripciones: '/tienda/suscripciones',
};

/**
 * Fachada de "mis medios de pago" de la tienda: expone la inscripción Oneclick
 * al usuario logueado con pagadorRef = usuarioId. El mapeo pagador ↔ usuario es
 * una regla de la tienda — la pasarela solo conoce pagadorRef opaco.
 */
@Injectable()
export class MediosPagoOnlineService {
  constructor(
    private readonly inscripciones: InscripcionesService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly suscripciones: SuscripcionesService,
    private readonly config: ConfigService,
  ) {}

  async listar(tenantId: string, usuarioId: string) {
    const [oneclickDisponible, lista, conteos] = await Promise.all([
      this.oneclickActivo(tenantId),
      this.inscripciones.listarPorPagador(tenantId, usuarioId),
      this.suscripciones.contarPorInscripcion(tenantId, usuarioId),
    ]);
    return {
      oneclickDisponible,
      medios: lista
        .filter((i) => i.estado === 'activa')
        .map((i) => ({
          ...i,
          // Suscripciones vigentes que se cancelarían si se elimina esta tarjeta.
          suscripcionesActivas: conteos[i.inscripcionId] ?? 0,
        })),
    };
  }

  async iniciar(
    tenantId: string,
    usuarioId: string,
    email: string,
    retornoPath?: string,
  ) {
    const base =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const path =
      RETORNO_PATHS[retornoPath ?? 'medios-pago'] ??
      RETORNO_PATHS['medios-pago'];
    const res = await this.inscripciones.iniciar(tenantId, {
      pagadorRef: usuarioId,
      email,
      urlRetorno: `${base}${path}`,
    });
    // El navegador debe llegar a Webpay con el token: mismo patrón GET que
    // Webpay Plus usa con token_ws (ver webpay-plus.provider.ts).
    const sep = res.urlWebpay.includes('?') ? '&' : '?';
    return {
      inscripcionId: res.inscripcionId,
      urlWebpay: `${res.urlWebpay}${sep}TBK_TOKEN=${res.token}`,
    };
  }

  /**
   * Elimina una tarjeta. Si tiene suscripciones vigentes amarradas, las cancela
   * primero (DB) y luego elimina la inscripción en Transbank. No es atómico por
   * la llamada externa; aceptable mientras no exista cobro recurrente.
   */
  async eliminar(tenantId: string, usuarioId: string, inscripcionId: string) {
    const { canceladas } = await this.suscripciones.cancelarPorInscripcion(
      tenantId,
      usuarioId,
      inscripcionId,
    );
    const res = await this.inscripciones.eliminar(
      tenantId,
      inscripcionId,
      usuarioId,
    );
    return { ...res, suscripcionesCanceladas: canceladas };
  }

  marcarPreferida(tenantId: string, usuarioId: string, inscripcionId: string) {
    return this.inscripciones.marcarPreferida(
      tenantId,
      inscripcionId,
      usuarioId,
    );
  }

  private async oneclickActivo(tenantId: string): Promise<boolean> {
    try {
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_TOKENIZADA,
      );
      return true;
    } catch {
      return false;
    }
  }
}
