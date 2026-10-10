import { expect } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * El total de una venta `canal: 'online'` con estas líneas, para pagarlo exacto.
 *
 * Varias suites venden por `POST /ventas` con `canal: 'online'` porque cuelga de la
 * caja virtual y no obliga a abrir una física. Hasta el 2026-10-10 pagaban un monto
 * redondo de sobra (`100000`, `2000000`) en efectivo y el resto salía como vuelto.
 * Desde la opción E de `docs/agent/pendientes.md` § 3 eso es 400: online, lo
 * pagado es igual al total, porque si no una tarjeta registraba un "vuelto" que
 * nadie devolvía. Lo pregunta al motor con el mismo canal: las promos se filtran
 * por canal, y el total sin él podría no ser el que la venta cobra.
 */
export async function totalOnline(
  app: INestApplication,
  token: string,
  lineas: { itemId: string; cantidad: string }[],
): Promise<string> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/calculo-precios/calcular')
    .set('Authorization', `Bearer ${token}`)
    .send({ canal: 'online', lineas });
  expect(res.status).toBe(201);
  return (res.body as { totales: { totalFinal: string } }).totales.totalFinal;
}
