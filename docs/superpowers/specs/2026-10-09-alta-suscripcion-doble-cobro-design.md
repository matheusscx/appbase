# Spec: medir el doble cobro del alta de suscripción

**Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora · Mide una entrada de
`pendientes.md` § 2 (*"Dos `POST /suscripciones` iguales cobran dos veces"*). **Mide, no arregla.**

## Problema

`SuscripcionesService.crear` cobra por Oneclick (paso 7, fuera de toda transacción) y después
crea la venta y la suscripción (paso 9). El endpoint no lleva `@ClaveIdempotencia()` (ADR-026) y
`suscripciones` no tiene restricción única. Leído, no medido: dos POST iguales serían dos cobros.

## Diseño de la medición

- **Un e2e de API** (`backend/test/suscripcion-alta-doble.e2e-spec.ts`) que levanta `AppModule`
  con tres providers sobrescritos, sin tocar Transbank ni la pasarela real:
  - `CobrosService`: `cobrar` cuenta llamadas y devuelve una orden `pagada` con un id nuevo;
    `vincularVenta` no hace nada.
  - `InscripcionesService`: `resolverMedioDeUsuario` devuelve un snapshot de tarjeta fijo.
  - `TenantPasarelaService`: `resolverConfiguracionActiva` resuelve (Oneclick activo).
- Escena de ADR-026: el alta entra, la respuesta se pierde y el cliente vuelve a confirmar. Dos POST
  **secuenciales** con el mismo body y la misma cabecera `Idempotency-Key` (para medir que hoy se
  ignora). Ítem del seed `Plan mensual demo` (Paris), usuario admin de Paris: el `POST` no pide
  permiso, cualquier usuario del tenant puede.
- **Qué cuenta:** llamadas a `cobrar`, suscripciones nuevas del usuario sobre ese ítem (delta) y
  ventas que existen entre las `ventaInicialId` devueltas.
- **Cómo queda commiteado:** el repo no tiene una forma propia de documentar un bug conocido en un
  test (sin `it.failing`, `it.skip` ni `xit` en `backend/test/`). Se usa un `it` normal que afirma
  **lo que pasa hoy** con los números exactos, no `it.failing`. `it.failing` pasa con **cualquier**
  excepción, y el control solo cubre el primer POST: un 500 en el segundo, o un arreglo a medias,
  quedaría verde. El `it` normal se pone rojo con cualquier cambio; cuando se arregle, se invierte
  la afirmación.

## Fuera de alcance

El arreglo. Si se confirma, no es mecánico (el cobro es HTTP fuera de la transacción y ADR-026
reclama la clave adentro). Las opciones van a la orquestadora y al owner. El owner eligió el mismo día la
de ADR-029 (`pendientes.md` § 3); la construye otro frente.
