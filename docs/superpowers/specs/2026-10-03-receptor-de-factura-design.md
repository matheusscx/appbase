# La Factura exige los datos tributarios del receptor

**Fecha:** 2026-10-03 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Frente:** *"La Factura exige receptor, pero el sistema solo le pide un nombre"*
(estaba en `pendientes.md` § 6; cerrada en [`resueltos.md`](../../agent/resueltos.md)).
**Decisiones:** el bloque "Cómo arrancarlo" de esa entrada, con quién y cómo se decidió cada una.

---

## 1. El problema

Una Factura chilena tiene que llevar del receptor RUT, razón social, giro, dirección y comuna
(SII, Formato DTE v2.5, 2026-02, zona Receptor, campos 50-65). El sistema exige solo un nombre
que no esté en blanco: no tiene dónde guardar giro ni comuna (`venta_customer`, `terceros`) y
acepta cualquier texto como RUT. Lo que no se captura al vender no se completa después (ADR-010):
la venta queda como una Factura que nunca se podrá emitir.

## 2. Reglas

1. **El país decide el conjunto.** Se lee el `codigo_iso` del país del tenant en la misma lectura
   que ya resuelve el tipo (`resolverTipoDocumento`).
   - **Chile:** un tipo `customer_requerido` exige RUT, razón social (`nombre`), giro, dirección y
     comuna, todos sin blanco tras `trim`. Todo RUT que venga en el customer —también en una
     boleta, también sin tipo exigente— tiene que ser un RUT: cuerpo 100.000–99.999.999 y DV
     módulo 11. Se guarda normalizado (`76543210-3`).
   - **Otro país (en pausa):** `customer_requerido` exige solo el nombre, como hasta hoy, y el RUT
     no se mira (un CUIT usa otro DV).
2. **Largos del SII en el DTO, para todo país:** `nombre` ≤ 100, `giro` ≤ 40, `direccion` ≤ 70,
   `comuna` ≤ 20. El sistema nunca trunca; la pantalla muestra el contador y no deja pasar.
3. **Se congela el body.** `giro` y `comuna` se agregan a `venta_customer` y a `terceros`. El
   formulario precarga desde el tercero y el servidor guarda lo que llegó, sin releer el tercero.
4. **La pantalla no decide el país.** `GET /tipos-documento` suma por tipo `receptorCompleto`
   (`customer_requerido` y Chile) y `rutChileno` (Chile). La pantalla valida con eso; el
   algoritmo del RUT existe dos veces (servidor y pantalla), atado por casos de prueba iguales.

## 3. Qué cambia

- **BD:** `venta_customer.giro varchar(40)`, `venta_customer.comuna varchar(20)`,
  `terceros.giro varchar(40)`, `terceros.comuna varchar(20)`, todas nullable. Sin backfill (sin
  datos productivos).
- **Backend:** `common/utils/rut.util.ts` (`normalizarRut`, que sale de `lectura-dte.service.ts`,
  y `rutValido`). `CustomerVentaDto` suma `giro`, `comuna` y los largos.
  `resolverTipoDocumento` valida el receptor según el país y devuelve el customer normalizado,
  que es el que se inserta. El detalle de la venta (`findOne`) devuelve `giro` y `comuna`.
  Terceros: entidad y DTO suman `giro` y `comuna` con sus largos.
- **Frontend:** `composables/useReceptor.ts` (RUT y "qué le falta al receptor"). `ClienteForm`
  suma giro y comuna con contador, marca obligatorios con `receptorCompleto` y avisa un RUT
  inválido con `rutChileno`, y precarga giro y comuna del tercero. `puedeCobrar` y el cobro del
  POS usan la misma regla. Terceros suma los dos campos.

## 4. Fuera

- La nota de crédito no copia el receptor de la venta que corrige (frente propio, anotado).
- El ticket impreso no suma giro ni comuna: hoy no es un DTE, y formatear se difiere (ADR-010).
- Validar el RUT de un tercero en su propia pantalla: la venta lo frena al usarlo.
- Salones: siempre cierra con boleta y no tiene formulario de cliente; hereda la validación del
  DTO compartido sin cambios de pantalla.
