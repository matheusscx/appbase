import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type JwtUser } from '../interfaces/jwt-user.interface';

/**
 * Lo que un request lleva consigo sin tener que enhebrarlo por parámetro.
 *
 * `decimales` es **memo por request**, no una caché global: ver el porqué en
 * `RequestContext`.
 */
export interface ContextoRequest {
  user?: JwtUser;
  decimales?: { tenantId: string; valor: Promise<number> };
}

/**
 * El usuario del request, disponible para un provider **singleton**.
 *
 * Existe por un costo **estructural**: pedir el request por inyección
 * (`@Inject(REQUEST)`) obliga al provider a `Scope.REQUEST`, y Nest propaga ese
 * scope **hacia arriba**, al controller anfitrión entero. `EscalaMonedaPipe`
 * cuelga de handlers de escritura en **once** controllers, así que sus rutas de
 * lectura se instanciaban de nuevo en cada request sin tocar el pipe. Lo caro no
 * es el costo por request: es que ese costo sea **invisible en el diff** —lo
 * paga un controller que ni menciona al provider— y que la única defensa fuera
 * una disciplina ("colgalo del controller más chico") que ninguna revisión puede
 * verificar.
 *
 * ⚠️ **No lo justifica un número de throughput.** La entrada que motivó esto
 * medía ~7% menos req/s con dos rondas por brazo; el A/B rehecho al migrar, con
 * seis rondas por brazo, **superpone los brazos** —domina el calentamiento—. El
 * detalle está en el docblock de `escala-moneda.pipe.ts`. Si alguien va a citar
 * un número para justificar un cambio de scope, que lo mida de nuevo.
 *
 * Es el mismo molde que [`TxContext`](../db/tx-context.ts) usa para el
 * `EntityManager` (**ADR-020**): un singleton que sabe de contexto, en vez de un
 * provider por request.
 *
 * **Medido antes de escribirlo** (spike del 2026-08-22), porque el punto dudoso
 * era el orden de ejecución —los pipes resuelven los argumentos cuando alguien
 * se suscribe al observable de `next.handle()`, que podría ser fuera del
 * `als.run`—: con un interceptor sembrando el store, un pipe singleton **sí** lo
 * ve; **20 requests concurrentes de tenants distintos dieron 0 cruzados**; un
 * request sin siembra **no** hereda el contexto del anterior; y el controller
 * queda con **una** instancia para N requests.
 *
 * ⚠️ Se siembra con `run`, no con `enterWith`. Las dos funcionaron en el spike,
 * pero `enterWith` no cierra el contexto al volver y su corrección depende de
 * que nadie más lo pise; `run` lo acota al callback.
 */
@Injectable()
export class RequestContext {
  private readonly als = new AsyncLocalStorage<ContextoRequest>();

  correrCon<T>(contexto: ContextoRequest, fn: () => T): T {
    return this.als.run(contexto, fn);
  }

  /** `undefined` fuera de un request (jobs, seeder, tests que no lo siembran). */
  actual(): ContextoRequest | undefined {
    return this.als.getStore();
  }
}
