import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Scope,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import Decimal from 'decimal.js';
import { MonedasService } from '../../modules/monedas/monedas.service';
import { type JwtUser } from '../interfaces/jwt-user.interface';
import { ESCALA_COSTO } from '../constants/escalas';
import {
  ESCALA_COSTO_KEY,
  ESCALA_MONEDA_KEY,
} from '../decorators/escala-moneda.decorator';

interface RequestConUsuario {
  user?: JwtUser;
}

/**
 * Rechaza en el borde los montos que traen más decimales de los que la plata
 * del tenant puede representar. Sin esto, `1000.55555` entra: el DTO valida
 * signo y formato pero no la escala, y el recorte lo termina haciendo Postgres
 * con su propia regla — el número guardado deja de ser el que se tecleó.
 * Decisión del owner: 400, nunca cuantizar en silencio.
 *
 * Se aplica por parámetro (`@Body(EscalaMonedaPipe)`), no global: es
 * request-scoped, y registrarlo global le cobraría el scope a toda la API.
 * Nest inscribe solo automáticamente los pipes de parámetro como injectables
 * del módulo del controller, así que ese módulo debe importar `MonedasModule`.
 */
@Injectable({ scope: Scope.REQUEST })
export class EscalaMonedaPipe implements PipeTransform {
  /**
   * Los decimales de la moneda, resueltos como mucho una vez. La instancia es
   * request-scoped, así que este memo es por request: un body con cien líneas
   * de pago sigue costando una sola consulta.
   */
  private decimales?: Promise<number>;

  constructor(
    private readonly monedas: MonedasService,
    @Inject(REQUEST) private readonly request: RequestConUsuario,
  ) {}

  async transform(valor: unknown, meta: ArgumentMetadata): Promise<unknown> {
    if (!meta.metatype || typeof valor !== 'object' || valor === null) {
      return valor;
    }
    await this.validarObjeto(valor as Record<string, unknown>, meta.metatype);
    return valor;
  }

  /**
   * Recorre el DTO y lo que cuelga de él: los montos cobrados viven tanto en
   * la raíz (`propina`) como dentro de listas anidadas (`pagos[].monto`).
   * El cuerpo viene de JSON, así que el árbol es finito y sin ciclos.
   */
  private async validarObjeto(
    objeto: Record<string, unknown>,
    clase: object,
  ): Promise<void> {
    const cobrados: string[] =
      (Reflect.getMetadata(ESCALA_MONEDA_KEY, clase) as string[]) ?? [];
    const costos: string[] =
      (Reflect.getMetadata(ESCALA_COSTO_KEY, clase) as string[]) ?? [];

    if (cobrados.length) {
      const escala = await this.decimalesDelTenant();
      for (const campo of cobrados) {
        this.validarCampo(objeto[campo], escala, campo);
      }
    }
    for (const campo of costos) {
      this.validarCampo(objeto[campo], ESCALA_COSTO, campo);
    }

    for (const anidado of Object.values(objeto)) {
      for (const hijo of Array.isArray(anidado) ? anidado : [anidado]) {
        if (typeof hijo === 'object' && hijo !== null) {
          await this.validarObjeto(
            hijo as Record<string, unknown>,
            (hijo as object).constructor,
          );
        }
      }
    }
  }

  private validarCampo(valor: unknown, escala: number, campo: string): void {
    // El formato ya lo valida `@IsNumberString`; acá solo importa la escala.
    // Se acepta también el número nativo por si un DTO lo dejara pasar: que
    // el borde lo ignore en silencio sería peor que revisarlo.
    if (typeof valor !== 'string' && typeof valor !== 'number') return;

    let monto: Decimal;
    try {
      monto = new Decimal(valor);
    } catch {
      return;
    }

    // La regla es sobre el VALOR, no sobre la cadena: Decimal normaliza los
    // ceros a la derecha, así que '1000.00' en CLP vale 1000 y es
    // representable. Rechazarlo sería castigar un formato, no un número.
    if (monto.decimalPlaces() > escala) {
      throw new BadRequestException(
        `${campo} tiene más decimales de los que admite la moneda (${escala}).`,
      );
    }
  }

  private decimalesDelTenant(): Promise<number> {
    if (!this.decimales) {
      // tenant_id SIEMPRE del token, nunca del body (invariante del proyecto).
      const tenantId = this.request.user?.tenantId;
      if (!tenantId) {
        throw new ForbiddenException('No hay tenant activo en el token');
      }
      this.decimales = this.monedas.decimalesOficiales(tenantId);
    }
    return this.decimales;
  }
}
