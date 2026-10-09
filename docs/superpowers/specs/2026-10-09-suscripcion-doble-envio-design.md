# Spec: el alta de suscripción de la tienda no se envía dos veces

**Date:** 2026-10-09 · **Origen:** `docs/agent/pendientes.md` § 2, "¿Un Enter en el formulario de
suscripción de la tienda da de alta dos veces?"

## Lo medido (vitest, `@vitest-environment nuxt`, happy-dom)

- El `UForm` del drawer no tiene ningún `input` ni `textarea`: los selectores son `USelectMenu`, cuyo
  buscador vive en un portal fuera del form. No hay campo desde el que un Enter haga envío implícito.
- Con el primer `POST /suscripciones` en vuelo, el botón "Suscribirme y pagar" queda `disabled`.
- Un segundo evento `submit` sobre el form, con el primer POST en vuelo, **llega a un segundo POST**:
  ni `confirmar()` ni `UForm` (`onSubmitWrapper` no mira su propio `loading`) frenan la reentrada.

No medido: si un usuario real puede producir ese segundo `submit` en un navegador. La orquestadora
decidió no medirlo (2026-10-09): el arreglo no cambia según la respuesta.

## Backend (leído, no medido)

`SuscripcionesService.crear` no usa `Idempotency-Key` (el decorador `ClaveIdempotencia`, ADR-026, lo
usan ventas, pagos, compras, salones y la pasarela) ni hay restricción única. Dos POST iguales cobran dos veces por Oneclick y
crean dos suscripciones con dos ventas. **No se toca en este frente** (orquestadora): va como entrada
nueva en `pendientes.md`.

## Diseño

Guard de reentrada al principio de `confirmar()`: `if (confirmando.value) return`. Spec de pantalla:
dos `submit` seguidos con el primer POST retenido → un solo `POST /suscripciones`. Mutante: revertir
el guard (volver al código anterior) y ver el spec en rojo.
