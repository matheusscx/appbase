import { expect } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * ⚠️ **Primer helper compartido de `backend/test/`.** Hasta el 2026-09-03 cada
 * spec e2e era autocontenido, y `CLAUDE.md` dice no crear archivos nuevos si la
 * implementación cabe en uno existente. Acá no cabe: `abrirCaja`/`cerrarCaja`
 * estaban copiados en **ocho** specs y las copias **ya habían derivado en la
 * conducta que verifican**, no solo en un string. Decisión del owner
 * (2026-09-03) → [`docs/agent/pendientes.md`](../../../docs/agent/pendientes.md).
 *
 * ## Lo que la medición encontró en las ocho copias, y qué quedó como canónico
 *
 * | Diferencia | Qué había | Qué quedó |
 * |---|---|---|
 * | `saldoInicial` | `100000` en seis, `10000` en `ventas` y `liquidacion-propinas` | **Parametrizable**, default `100000` — el valor es libre, lo que no es libre es que el conteo declare **el mismo** |
 * | Status de `abrir` | `[200, 201]` en `costeo-cpp`, `toBe(201)` en las otras siete | **`toBe(201)`**: ningún POST de `caja.controller.ts` declara `@HttpCode`, así que Nest devuelve 201 y el rango era ruido defensivo |
 * | Fase 2 del cierre | **`costeo-cpp` no la tenía** | **Siempre**, ver abajo |
 * | `comentarioDiferencia` | Solo en `items-pausados` | **Siempre**: no cuesta nada y deja dicho quién cerró |
 *
 * 🎯 **El agujero real que la extracción cierra es el de `costeo-cpp`.** Su
 * `cerrarCaja` hacía **solo la fase 1**, y nunca falló porque esa suite no vende
 * en efectivo (`EFECTIVO_ID`: cero usos), así que su caja siempre cuadra y
 * auto-cierra. El día que venda una moneda en efectivo, la caja queda
 * `en_conciliacion`, **el cajón queda ocupado** y la suite siguiente falla con un
 * `409` al abrir — un rojo críptico en un archivo ajeno.
 *
 * ## Por qué el saldo y el conteo viajan juntos
 *
 * **El conteo declara solo el saldo inicial**, nunca las ventas: por eso una
 * suite que vendió en efectivo **siempre** descuadra, y la fase 2 existe para
 * resolver ese descuadre con un motivo. Que las dos funciones estuvieran
 * separadas dejaba la coherencia del par librada a que ocho archivos se
 * acordaran de tocar los dos números a la vez. Acá `cerrarCaja` **cuenta lo que
 * `abrirCaja` declaró**, así que desincronizarlos ya no es posible.
 *
 * ## Las dos fases, y por qué la primera sola no alcanza
 *
 * `POST /:id/conteo` congela el arqueo y **auto-cierra si cuadra**; si descuadra
 * pasa a `en_conciliacion` y hay que resolver la fase 2 con `POST /:id/cerrar`,
 * que **exige un motivo por línea descuadrada** (mandar `lineas: []` da 400 y
 * deja el cajón ocupado igual).
 */
export interface CajaAbierta {
  id: string;
  /** Lo que se declaró al abrir. `cerrarCaja` cuenta EXACTAMENTE esto. */
  saldoInicial: string;
}

/** Default histórico: seis de las ocho copias abrían con este saldo. */
const SALDO_INICIAL_DEFAULT = '100000.0000';

export async function abrirCaja(
  app: INestApplication<App>,
  token: string,
  opts: { saldoInicial?: string; comentario?: string } = {},
): Promise<CajaAbierta> {
  const saldoInicial = opts.saldoInicial ?? SALDO_INICIAL_DEFAULT;

  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  expect(disp.status).toBe(200);
  const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;

  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial,
      comentario: opts.comentario ?? 'Apertura E2E',
    });
  expect(res.status).toBe(201);

  return { id: (res.body as { id: string }).id, saldoInicial };
}

/**
 * Cierra **asegurando** las dos fases. El teardown afirma sobre cada status en
 * vez de ignorarlos: si el cierre vuelve a romperse se ve acá, y no como un
 * `409` críptico en la suite siguiente.
 */
export async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  caja: CajaAbierta,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${caja.id}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      // Solo el saldo inicial, a propósito: ver el docblock de arriba.
      lineas: [{ metodoPagoId: null, montoContado: caja.saldoInicial }],
    });
  expect(conteo.status).toBe(201);

  if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') return;

  const motivos = await request(app.getHttpServer())
    .get('/api/motivos-diferencia?soloActivas=true')
    .set('Authorization', `Bearer ${token}`);
  expect(motivos.status).toBe(200);
  const motivoId = (motivos.body as { id: string }[])[0]?.id;

  const cierre = await request(app.getHttpServer())
    .post(`/api/caja/${caja.id}/cerrar`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      lineas: [
        {
          metodoPagoId: null,
          motivoDiferenciaId: motivoId,
          comentarioDiferencia: 'Cierre de la suite e2e',
        },
      ],
    });
  expect(cierre.status).toBe(201);
}
