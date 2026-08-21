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
 * Tope de anidamiento que se inspecciona. La recursión baja sincrónicamente y
 * la profundidad la elige el cliente: dentro del límite de body por defecto
 * entran decenas de miles de niveles, que serían un RangeError —un 500— en vez
 * de un rechazo. Ningún DTO del proyecto se acerca a 20.
 */
const PROFUNDIDAD_MAX = 20;

/**
 * Rechaza en el borde los montos que traen más decimales de los que la plata
 * del tenant puede representar. Sin esto, `1000.55555` entra: el DTO valida
 * signo y formato pero no la escala, y el recorte lo termina haciendo Postgres
 * con su propia regla — el número guardado deja de ser el que se tecleó.
 * Decisión del owner: 400, nunca cuantizar en silencio.
 *
 * Se aplica por parámetro (`@Body(EscalaMonedaPipe)`), no global. Es
 * request-scoped, y Nest hace request-scoped al **controller anfitrión
 * entero**: si se cuelga de un controller, sus rutas se instancian de nuevo en
 * cada request, también las que no tocan plata. Por eso conviene colgarlo del
 * controller más chico que cubra los DTOs marcados, y por eso registrarlo
 * global le cobraría ese costo a toda la API.
 *
 * Nest inscribe solo automáticamente los pipes de parámetro como injectables
 * del módulo del controller, así que ese módulo debe importar `MonedasModule`.
 *
 * ⚠️ Un DTO anidado sin `@Type()` **no se valida**: el recorrido reconoce a los
 * hijos por su `constructor`, y sin `@Type()` el hijo queda como objeto plano
 * (`Object`), sin marcas que leer. Marcar campos dentro de un anidado exige
 * `@Type()` en el padre. Fijado por el test "LIMITACIÓN CONOCIDA".
 */
@Injectable({ scope: Scope.REQUEST })
export class EscalaMonedaPipe implements PipeTransform {
  /**
   * Los decimales de la moneda, resueltos como mucho una vez: un body con cien
   * líneas de pago cuesta una sola consulta. Va con la clave del tenant a
   * propósito. Hoy el scope request alcanzaría, pero entonces la corrección de
   * la caché dependería enteramente de ese scope: al que le saque el
   * `Scope.REQUEST`, los decimales del primer tenant le servirían a todos los
   * demás en silencio. Es plata y es multi-tenant.
   */
  private memo?: { tenantId: string; decimales: Promise<number> };

  constructor(
    private readonly monedas: MonedasService,
    @Inject(REQUEST) private readonly request: RequestConUsuario,
  ) {}

  async transform(valor: unknown, meta: ArgumentMetadata): Promise<unknown> {
    if (!meta.metatype || typeof valor !== 'object' || valor === null) {
      return valor;
    }
    await this.validarObjeto(
      valor as Record<string, unknown>,
      meta.metatype,
      0,
    );
    return valor;
  }

  /**
   * Recorre el DTO y lo que cuelga de él: los montos cobrados viven tanto en
   * la raíz (`propina`) como dentro de listas anidadas (`pagos[].monto`).
   * El cuerpo viene de JSON, así que el árbol es finito y sin ciclos.
   */
  private async validarObjeto(
    objeto: Record<string, unknown>,
    clase: unknown,
    profundidad: number,
  ): Promise<void> {
    if (profundidad > PROFUNDIDAD_MAX) {
      throw new BadRequestException(
        `El cuerpo anida más de ${PROFUNDIDAD_MAX} niveles.`,
      );
    }

    const cobrados = camposMarcados(ESCALA_MONEDA_KEY, clase);
    if (cobrados.length) {
      const escala = await this.decimalesDelTenant();
      for (const campo of cobrados) {
        this.validarCampo(objeto[campo], escala, campo, 'moneda');
      }
    }
    for (const campo of camposMarcados(ESCALA_COSTO_KEY, clase)) {
      this.validarCampo(objeto[campo], ESCALA_COSTO, campo, 'costo');
    }

    for (const anidado of Object.values(objeto)) {
      for (const hijo of Array.isArray(anidado) ? anidado : [anidado]) {
        if (typeof hijo === 'object' && hijo !== null) {
          await this.validarObjeto(
            hijo as Record<string, unknown>,
            (hijo as Record<string, unknown>).constructor,
            profundidad + 1,
          );
        }
      }
    }
  }

  private validarCampo(
    valor: unknown,
    escala: number,
    campo: string,
    tipo: 'moneda' | 'costo',
  ): void {
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
    if (monto.decimalPlaces() <= escala) return;

    // El límite de los costos no es el de la moneda (en CLP la moneda admite
    // cero decimales, y el costo cuatro): confundirlos manda a revisar la
    // configuración del tenant por un límite que no depende de ella.
    throw new BadRequestException(
      tipo === 'moneda'
        ? `${campo} tiene más decimales de los que admite la moneda (${escala}).`
        : `${campo} admite como máximo ${escala} decimales (escala fija de costos y tasas).`,
    );
  }

  private decimalesDelTenant(): Promise<number> {
    // tenant_id SIEMPRE del token, nunca del body (invariante del proyecto).
    const tenantId = this.request.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('No hay tenant activo en el token');
    }
    if (this.memo?.tenantId !== tenantId) {
      this.memo = {
        tenantId,
        decimales: this.monedas.decimalesOficiales(tenantId),
      };
    }
    return this.memo.decimales;
  }
}

/**
 * Los campos marcados de una clase. `Reflect.getMetadata` tira `TypeError` si
 * el target no es un objeto, y el cliente elige las llaves de los campos
 * `@IsObject()` libres —que `whitelist: true` no limpia por dentro—, así que un
 * `{"constructor": "x"}` en el body llegaría acá como string. Sin este filtro,
 * ese cuerpo convierte un 400 en un 500.
 */
function camposMarcados(clave: string, clase: unknown): string[] {
  if (typeof clase !== 'function') return [];
  return (Reflect.getMetadata(clave, clase) as string[]) ?? [];
}
