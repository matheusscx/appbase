import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { MonedasService } from '../../modules/monedas/monedas.service';
import { RequestContext } from '../context/request-context';
import { ESCALA_COSTO } from '../constants/escalas';
import {
  ESCALA_COSTO_KEY,
  ESCALA_MONEDA_KEY,
} from '../decorators/escala-moneda.decorator';

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
 * Se aplica por parámetro (`@Body(EscalaMonedaPipe)`), no global.
 *
 * ✅ **Es SINGLETON desde el 2026-08-22.** Hasta entonces pedía el request por
 * inyección (`@Inject(REQUEST)`), lo que lo hacía `Scope.REQUEST` — y Nest
 * propaga ese scope al **controller anfitrión entero**, así que las rutas de
 * lectura de once controllers se instanciaban de nuevo en cada request sin tocar
 * el pipe. Hoy el tenant sale de [`RequestContext`](../context/request-context.ts),
 * un ALS sembrado por un interceptor global, y **no queda ningún provider
 * request-scoped en `src/`**.
 *
 * ⚠️ **La justificación de rendimiento resultó más blanda de lo que esta doc
 * decía, y conviene saberlo antes de citarla.** La medición del 2026-08-21
 * (`GET /items`, 20 concurrentes) daba **~7% menos req/s y ~13% más p95** con el
 * pipe puesto, y afirmaba *"sin solapamiento entre brazos"* — con **dos** rondas
 * por brazo. Al migrar se rehízo el A/B en la misma máquina y con el mismo arnés,
 * **seis rondas por brazo**, y los tres tramos (singleton ×2 pasadas,
 * request-scoped ×1) **se superponen**: 534-603 req/s contra 539-591. Lo que
 * domina la serie es el **calentamiento** —la ronda 1 arranca en ~420-460 req/s y
 * sube hasta ~600 en las tres—, no el scope. O sea que el 7% no se reproduce:
 * era una diferencia dentro del ruido que dos rondas no alcanzaban a ver.
 *
 * **Entonces por qué se migró igual:** el motivo que queda en pie es
 * **estructural**, no de números. Un provider request-scoped contagia a quien lo
 * hospede, así que el costo de colgar este pipe de un controller nuevo era
 * invisible y crecía solo; y la regla que la doc daba —"colgalo del controller
 * más chico"— es una disciplina que nadie puede verificar en una revisión. Como
 * singleton, aplicarlo donde haga falta ya no arrastra a nadie.
 *
 * Nest inscribe solo automáticamente los pipes de parámetro como injectables
 * del módulo del controller, así que ese módulo debe importar `MonedasModule`.
 *
 * ⚠️ Un DTO anidado sin `@Type()` **no se valida**: el recorrido reconoce a los
 * hijos por su `constructor`, y sin `@Type()` el hijo queda como objeto plano
 * (`Object`), sin marcas que leer. Marcar campos dentro de un anidado exige
 * `@Type()` en el padre. Fijado por el test "LIMITACIÓN CONOCIDA".
 */
@Injectable()
export class EscalaMonedaPipe implements PipeTransform {
  constructor(
    private readonly monedas: MonedasService,
    private readonly contexto: RequestContext,
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

  /**
   * Los decimales de la moneda del tenant, resueltos **como mucho una vez por
   * request**: un body con cien líneas de pago cuesta una sola consulta.
   *
   * ⚠️ El memo vive en el **store del request**, no en la instancia, y ésa es la
   * única razón por la que este pipe puede ser singleton. Un memo de instancia
   * le serviría los decimales del primer tenant a todos los demás, en silencio y
   * sobre plata. Igual va con la clave del tenant al lado: el día que el store
   * lleve algo más que un usuario, el memo no se puede quedar sin dueño.
   */
  private decimalesDelTenant(): Promise<number> {
    const ctx = this.contexto.actual();
    // tenant_id SIEMPRE del token, nunca del body (invariante del proyecto).
    const tenantId = ctx?.user?.tenantId;
    if (!ctx || !tenantId) {
      throw new ForbiddenException('No hay tenant activo en el token');
    }
    if (ctx.decimales?.tenantId !== tenantId) {
      ctx.decimales = {
        tenantId,
        valor: this.monedas.decimalesOficiales(tenantId),
      };
    }
    return ctx.decimales.valor;
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
