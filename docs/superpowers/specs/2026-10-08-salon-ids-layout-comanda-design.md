# Spec: el salón — ids en mayúsculas, layout con mesa borrada, y el confirmar legado de la comanda

**Date**: 2026-10-08 · **Owner**: sesión "Salón: transferencia a sí mismo, layout borrado y comanda"

Tres entradas de `docs/agent/pendientes.md`, todas leídas y no medidas. Las tres se midieron por
HTTP contra Postgres (e2e de medición, base `d14d6e29`) antes de diseñar nada.

## 1. `transferir-admin` y `fusionar` con ids en mayúsculas (§ 1)

**Medido.** Cuenta abierta por el garzón G; `POST /cuentas/:id/transferir-admin` con
`garzonId = G.toUpperCase()` → **201**, y el historial queda con un tramo `transferencia_admin`
de G a G. El mismo pedido en minúsculas → 400 *"El garzón ya es responsable de la cuenta"*.
`POST /mesas/:id/cuentas/fusionar` con `[X, x]` → 400 *"Todas las cuentas a fusionar deben
pertenecer a la mesa y estar abiertas"*, sin escribir nada; con `[x, x]` el mensaje es el
correcto, *"Selecciona al menos dos cuentas para fusionar"*.

**Diseño.** `@IdEnMinusculas()` en `TransferirCuentaAdminDto.garzonId` y en
`FusionarCuentasDto.cuentaIds`: es la forma del borde cuando el campo lo compara alguien que no
es la función de entrada (`cuenta.garzonResponsableId === destinoGarzonId` vive dos llamadas más
abajo, en `CuentaAsignacionesService.transferir`). Con eso `[X, x]` llega como `[x, x]` y da el
mensaje de "al menos dos".

## 2. `PATCH /salones/:salonId/layout` con una mesa borrada (§ 2)

**Medido.** Borrada M2, el layout con M1 y M2 → **200**, y M2 queda con la posición nueva y
`eliminado_el` puesto (se lee igual desde la papelera, `GET /salones?incluirEliminados=true`).

**Lo que lo hace una decisión.** La pantalla (`configuracion/salones.vue`, `guardarDistribucion`)
manda **todas** las mesas que cargó en cada `dragend`. Si otro admin borra una mesa después, el
próximo arrastre de cualquier mesa lleva el id borrado: con el 404 que proponía la entrada, el
guardado entero falla, con un mensaje que dice "no pertenece al salón", hasta recargar.

**Diseño** (orquestadora, 2026-10-08; la Sesión de esfuerzo máximo se cerró sin contestar): se
saltean las borradas. Un id que no es del salón sigue siendo 404 y no se escribe ninguna; una mesa
borrada del salón no se escribe y el resto se guarda.

## 3. `POST /cuentas/:id/comanda` y `cantidadEnviada` (§ 2)

**Medido** (línea de `cantidad` 2 salvo donde se dice):

| Entrada | Respuesta | Queda en la base |
|---|---|---|
| `-1` | 201 | enviada −1; la comanda pendiente reclama 3; la línea se puede quitar |
| `10` en una línea de 3 | 201 | enviada 10; anular 2 → cantidad 1, enviada 8; anular 5 → **500** (`descontarReparto`, con rollback) |
| `0.00005` | 201 | enviada 0.0001 (redondea Postgres) |
| `1.123456` | 201 | enviada 1.1235 |
| `99999999999999999999` | **500** (`22003`) | sin cambio |
| `2` en una línea nunca despachada | 201 | se puede anular entera con un motivo que mueve stock |

Nada de producción llama a la ruta: el frontend usa `/comanda/reclamar`.

**Diseño: se retira en vez de validarse** (owner, 2026-10-08, vía la orquestadora). Ninguna cota cierra
la última fila de la tabla, y la ruta no tiene usuarios. Se van la ruta, `confirmarComanda`, su DTO y
sus tests; lo que esos tests fijaban y sigue vigente —que `cantidad_enviada` solo se escribe en líneas
vivas de la cuenta de la ruta— pasa a `reclamar`, que no recibe ids del cliente pero tiene ese mismo
`WHERE`. La validación que el frente puso primero (piso en lo despachado, techo en la cantidad,
escala 4) se fue con la ruta.
