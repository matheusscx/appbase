import { expect } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * Cuenta un producto y aplica el recuento, en las cuatro llamadas que pide la
 * API: crear la sesión, leer su detalle para sacar el `lineaId`, informar lo
 * contado y aplicar.
 *
 * ⚠️ **Se extrae en la TERCERA copia, no antes.** `CLAUDE.md` § Archivos:
 * duplicar dos veces es aceptable. Las dos primeras vivían en
 * `reportes-varianza.e2e-spec.ts` y `reportes-varianza-buckets.e2e-spec.ts`; la
 * tercera llegó con `reportes-varianza-plata.e2e-spec.ts` y ahí se extrajo. El
 * molde es `helpers/caja.ts`, el primer helper compartido de `backend/test/`.
 *
 * 📌 **Lo que las tres copias tenían distinto, y cómo quedó:**
 * - la **ubicación**: dos usaban el local resuelto en el `beforeAll`, la tercera
 *   una bodega propia por test. Queda como parámetro obligatorio, porque el
 *   recuento es **por ubicación** y un default acá metería el conteo en el local
 *   cada vez que una suite se olvide de pasarlo.
 * - lo que **devuelven**: una devolvía el `recuentoId`, las otras `void`. Queda
 *   devolviéndolo: el que no lo necesita lo ignora, y el que sí —para afirmar
 *   sobre `recuentoInicialId`— no tiene que repetir el POST.
 *
 * ⚠️ **Afirma sobre cada status.** Sin eso, un recuento que no se aplicó
 * —porque la línea no existía, o porque el motivo estaba inactivo— sigue de
 * largo y el test falla después, en la aserción del reporte, señalando al
 * lugar equivocado. Es la misma regla que el hook de pre-commit ya exige para
 * los helpers de `backend/test/`.
 */
export async function contarYAplicar(
  app: INestApplication<App>,
  token: string,
  params: {
    ubicacionId: string;
    itemId: string;
    cantidadContada: string;
    motivoDiferenciaId: string;
  },
): Promise<string> {
  const { ubicacionId, itemId, cantidadContada, motivoDiferenciaId } = params;

  const resCreate = await request(app.getHttpServer())
    .post('/api/recuentos')
    .set('Authorization', `Bearer ${token}`)
    .send({ ubicacionId, itemIds: [itemId] });
  expect(resCreate.status).toBe(201);
  const recuentoId = (resCreate.body as { id: string }).id;

  const resDetalle = await request(app.getHttpServer())
    .get(`/api/recuentos/${recuentoId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(resDetalle.status).toBe(200);
  const lineaId = (
    resDetalle.body as { lineas: { lineaId: string; itemId: string }[] }
  ).lineas.find((l) => l.itemId === itemId)!.lineaId;

  const resConteo = await request(app.getHttpServer())
    .patch(`/api/recuentos/${recuentoId}/lineas/${lineaId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ cantidadContada, motivoDiferenciaId });
  expect(resConteo.status).toBe(200);

  const resAplicar = await request(app.getHttpServer())
    .post(`/api/recuentos/${recuentoId}/aplicar`)
    .set('Authorization', `Bearer ${token}`);
  expect(resAplicar.status).toBe(201);

  return recuentoId;
}
