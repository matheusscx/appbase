# Spec: un REFUND sin confirmar gasta el tope por pago de la nota del POS

**Date**: 2026-10-04 · **Entrada**: `docs/agent/pendientes.md` § 2 · **Relacionado**: ADR-029, ADR-026

## Problema (medido)

Orden de $100.000 con venta online de un único pago. El admin reembolsa $17.000 y Transbank no
contesta: el `REFUND` queda en `iniciada` (sin confirmar). En el POS, el detalle de la venta ofrece
"Tarjeta · $100.000" y la nota por el pago de $100.000 da 201: `corregibles`
(`venta-documentos.service.ts`) solo resta los `REFUND` en `aprobada`. Cuando después se aclara
"salió", la corrección del REFUND falla ("excede lo disponible para nota de crédito (0)"): al
cliente le volvieron $117.000.

Un sin confirmar **no tiene tope de tiempo**: no hay cron, abrir la orden no lo aclara y la clave
del modal vive en memoria de la pestaña. Lo aclara solo una persona en Pasarela (reintento, otro
reembolso por la decisión 4, *Volver a consultar* o *Salió/No salió*). Mientras tx1 está en vuelo
no hay hueco: tiene el `FOR UPDATE` de la venta.

## Decisión

- **Owner (2026-10-04, AskUserQuestion de la Sesión de esfuerzo máximo):** *"Descuenta lo sin
  confirmar"*. El detalle ofrece $83.000 y explica *"$17.000 en un reembolso por Transbank sin
  confirmar"*. Si después se aclara "no salió", vuelve solo. Costo aceptado: si no salió, esos
  $17.000 no se devuelven por la tarjeta hasta que el admin lo aclare. Descartadas: frenar todo
  hasta aclarar y que el POS consulte a Transbank.
- **t1 (Sesión de esfuerzo máximo):** la re-verificación de tx1 excluye su **propio** `iniciada`,
  identificado por id. Otro sin confirmar, si lo hubiera, cuenta.
- **t2 (Sesión de esfuerzo máximo):** `devuelto-venta.ts` no se toca. Es un reporte de hechos y cuenta
  solo lo aprobado, en la fecha del REFUND (`fecha_transaccion`, escrita en tx0). Costo: el
  Cobrado/Devuelto de un día pasado cambia cuando se aclara un sin confirmar de ese día.

## Diseño

- `corregibles` suma, además de `reembolsado_sin_correccion`, los `REFUND` en `iniciada`/`error`
  de las órdenes de la venta (`sin_confirmar`). Va en la misma consulta, como otra columna. Con un
  único pago, los dos restan del `devolvible`, con el mismo criterio que hoy.
- `VentaDeLosDocumentosParams` suma `excluirReembolsoId?`. Lo pasan
  `devolvibleDelPagoUnico`, `exigirTopeDelReembolsoPasarela`, el handler
  (`ReembolsoCallbackHandler.exigirTopeDelReembolso`) y `CobrosService.verificarReembolsable` con su `propio`
  (null en tx0, el id del REFUND en tx1).
- `OpcionDevolucion.sinConfirmar: string | null`: lo sin confirmar ya descontado de `monto`, para
  el texto. El modal lo muestra en la descripción de la opción.
- Una venta con más de un pago sigue sin tope por pago (sin cambio).

## Verificación (contra la serie)

e2e `pasarela-reembolso.e2e-spec.ts`:
1. Sin confirmar 17.000 → el detalle ofrece 83.000 con `sinConfirmar` 17.000; la nota de 83.001
   da 400 sin cifras; "salió" → la corrección del REFUND entra; la serie de correcciones suma
   100.000 y la nota de 83.000 sigue entrando.
2. Sin confirmar 17.000 → "no salió" → el detalle vuelve a ofrecer 100.000.
3. Un reembolso total con su propio `iniciada` no se rechaza a sí mismo (mutante: sin la
   exclusión, se rechaza).
Más Playwright de la pantalla de la nota con el texto.
