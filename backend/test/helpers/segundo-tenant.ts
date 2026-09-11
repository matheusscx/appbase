import { expect } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * El **segundo tenant sembrado**: entrar en él y pedirle su local.
 *
 * Segundo helper compartido de `backend/test/`, por decisión del owner
 * (2026-09-09) sobre la pregunta que estaba abierta en
 * [`docs/agent/pendientes.md`](../../../docs/agent/pendientes.md) § 4. El primero
 * (`caja.ts`) se extrajo porque sus ocho copias **ya habían derivado en la
 * conducta**; acá no es ese el motivo —ver "Qué se midió"—, así que vale decir
 * cuál es: la regla escrita del repo (*"duplicar dos veces es aceptable, se
 * extrae a la tercera"*) estaba pasada.
 *
 * ⚠️ **La entrada que mandó extraerlo decía cuatro copias, y eran siete.** Las
 * siete llaman acá: la séptima —`alta-usuarios-tenant`— quedó afuera del cierre
 * que creó este archivo y se convirtió el 2026-09-11. Que un spec siga
 * declarando el uuid del segundo tenant no lo vuelve copia de este bloque: los
 * que quedan usan el login genérico de dos pasos (ver "Qué NO entra acá") o lo
 * usan como dato, sin loguearse ahí.
 *
 * ## ⚠️ "Falabella" no existe
 *
 * El seed crea dos tenants y las constantes que los nombran en el código
 * **mienten**: son nombres de tiendas chilenas que quedaron de una versión vieja
 * y nadie renombró cuando cambiaron los nombres visibles.
 *
 * | Constante en el código | Cómo se llama el tenant en los datos |
 * |---|---|
 * | `PARIS` (`…440007`) | **Demo Restaurante** |
 * | `FALABELLA` (`…440040`) | **Demo Bodega** |
 *
 * Y el "admin de Falabella" tampoco existe: `ADMIN_FALABELLA` —el objeto que
 * sigue vivo en `cajones`, `garzon-pin` y `uso-reglas`— **es**
 * `admin@sistema.com`, que simplemente se cambia de tenant. No hay un admin
 * propio de ese lado. Ojo con la tentación de llamarlo "el usuario de todas las
 * suites": lo nombran **10** de los 70 specs (11 archivos, contando este
 * helper); el que usan las suites es `admin.paris@paris.cl`, en **63**.
 *
 * Por eso este archivo lo nombra por lo que **es** —el segundo tenant sembrado—
 * y no por lo que las constantes dicen. Renombrarlas es otra cosa: **438 líneas
 * en 64 archivos** (465 apariciones con `-o`; hay líneas que nombran las dos),
 * así que va como frente propio o no va. El comando de abajo devuelve 442 y 65
 * porque **este docblock se cuenta a sí mismo** —cuatro líneas de acá arriba—;
 * la superficie del renombre no incluye la prosa que lo describe:
 *
 * ```bash
 * grep -rn "FALABELLA\|PARIS" backend/src backend/test | wc -l
 * ```
 *
 * ## Sirve para dos papeles opuestos, y por eso el nombre es neutro
 *
 * - **Tenant ajeno** — el papel de las cuatro copias del bloque completo: se pide
 *   un recurso REAL del otro lado (su local) para mandarlo con el token de Paris
 *   y verificar que el rechazo cross-tenant es el mismo 404 opaco que el de "no
 *   existe". Un uuid inventado no sirve: daría 404 por no existir, y el test
 *   pasaría aunque el service no filtrara por tenant.
 * - **Tenant propio** — el papel en `papelera` y `tienda-pasarela-demo`, que
 *   operan ahí adentro justamente porque **no tiene catálogo sembrado**: lo que
 *   crean no depende de ningún id del seed ni le pisa nada a las otras suites.
 *
 * ## Qué se midió antes de extraer (2026-09-09)
 *
 * **No hay deriva de conducta** —a diferencia del caso de `caja.ts`—: los seis
 * sitios hacen el mismo login de dos pasos, todos mandan la cookie y todos
 * afirman sobre los dos status. La única deriva es de forma, y sirve igual como
 * aviso: `mermas` tenía el uuid **hardcodeado inline** con un `// Falabella` al
 * lado en vez de la constante que usan las otras cinco, y esa constante estaba
 * declarada por separado en doce specs.
 *
 * ## Qué NO entra acá
 *
 * El login de dos pasos genérico —`login(app, email, password, tenantId)`— vive
 * copiado en muchos más specs: `git grep -l "auth/switch-tenant" -- backend/test`
 * lista 67 archivos, y **dos no son specs** —este helper y `setup-supertest.ts`,
 * que `jest-e2e.json` registra como setup—, así que son **65 specs**, casi
 * siempre contra Paris. **Es otro patrón, mucho más ancho**,
 * y meterlo en este archivo lo convertiría en el `helpers.ts` genérico que
 * `CLAUDE.md` prohíbe. Si alguna vez se comparte, se decide aparte.
 */
const SEGUNDO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

/** El admin del seed, que pertenece a los dos tenants. No es un usuario aparte. */
const ADMIN_EMAIL = 'admin@sistema.com';
const ADMIN_PASS = 'admin';

/**
 * Login en dos pasos: `POST /auth/login` y `POST /auth/switch-tenant`.
 *
 * La cookie del primer paso viaja al segundo a propósito: `switch-tenant` lee
 * `req.cookies`, y sin ella corta con 401. El spec que llame acá necesita
 * `app.use(cookieParser())` en su `beforeAll` —`cookieParser` vive en `main.ts`,
 * que el e2e no ejecuta—, que es lo que ya hacen todos los que llaman
 * acá.
 */
export async function loginSegundoTenant(
  app: INestApplication<App>,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set(
      'Authorization',
      `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
    )
    .send({ tenantId: SEGUNDO_TENANT_ID });
  expect(resTenant.status).toBe(200);

  return (resTenant.body as { access_token: string }).access_token;
}

/**
 * El login + **su ubicación de tipo `local`**, que es la que de verdad hace falta
 * para el caso cross-tenant: toda venta descuenta del local, así que es la
 * ubicación que el service del otro lado va a buscar y no encontrar.
 *
 * Devuelve también el token porque uno de los cuatro llamadores lo sigue usando
 * después —`traslados`, que arma motivo y stock de ese lado—, y volver a
 * loguearse para eso costaría dos requests de más. Los otros tres solo
 * desestructuran `localId`.
 */
export async function localDelSegundoTenant(
  app: INestApplication<App>,
): Promise<{ token: string; localId: string }> {
  const token = await loginSegundoTenant(app);

  const resUbic = await request(app.getHttpServer())
    .get('/api/ubicaciones')
    .set('Authorization', `Bearer ${token}`);
  expect(resUbic.status).toBe(200);

  const local = (resUbic.body as { id: string; tipo: string }[]).find(
    (u) => u.tipo === 'local',
  );
  expect(local).toBeDefined();

  return { token, localId: local!.id };
}
