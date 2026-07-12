import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';

const PASARELA_TOKENIZADA = 'oneclick';

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
    private readonly config: ConfigService,
  ) {}

  async listar(tenantId: string, usuarioId: string) {
    const [oneclickDisponible, lista] = await Promise.all([
      this.oneclickActivo(tenantId),
      this.inscripciones.listarPorPagador(tenantId, usuarioId),
    ]);
    return {
      oneclickDisponible,
      medios: lista.filter((i) => i.estado === 'activa'),
    };
  }

  async iniciar(tenantId: string, usuarioId: string, email: string) {
    const urlRetorno = `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'}/tienda/medios-pago`;
    const res = await this.inscripciones.iniciar(tenantId, {
      pagadorRef: usuarioId,
      email,
      urlRetorno,
    });
    // El navegador debe llegar a Webpay con el token: mismo patrón GET que
    // Webpay Plus usa con token_ws (ver webpay-plus.provider.ts).
    const sep = res.urlWebpay.includes('?') ? '&' : '?';
    return {
      inscripcionId: res.inscripcionId,
      urlWebpay: `${res.urlWebpay}${sep}TBK_TOKEN=${res.token}`,
    };
  }

  eliminar(tenantId: string, usuarioId: string, inscripcionId: string) {
    return this.inscripciones.eliminar(tenantId, inscripcionId, usuarioId);
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
