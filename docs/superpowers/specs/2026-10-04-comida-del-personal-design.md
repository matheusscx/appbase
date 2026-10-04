# La comida del personal, con motivo propio y sin IVA

**Fecha:** 2026-10-04 · **Tipo:** spec de diseño · **Frente fiscal** (va solo: `CLAUDE.md`, ADR-010)
**Entrada:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 6, *"La comida del personal no
tiene motivo propio, y como cortesía pagaría IVA de más"*, con las decisiones anotadas ahí.
**Investigación:** [`2026-10-03-cortesia-retiro-iva.md`](../../agent/investigaciones/2026-10-03-cortesia-retiro-iva.md)
§ 1, escena c.

---

## 1. El problema

Desde el 2026-10-03 toda anulación de tipo `cortesia` congela el IVA del retiro. El personal comiendo
**dentro** del local no es retiro (Reglamento DS 55/1977 art. 11; Oficio 734/2002), así que como
cortesía el reporte le suma un IVA que no debe. Como `merma`, en cambio, aparece como pérdida en
Mermas, en el bloque "Pérdidas" del Inicio y en el reporte de varianza. Hoy no hay forma correcta de
registrarla.

## 2. Decisiones (detalle y procedencia en la entrada de `pendientes.md`)

| # | Decisión | Quién |
|---|---|---|
| D1 | Cuarto tipo `consumo_personal`: descuenta stock, no congela IVA; kardex igual que la cortesía (`motivo 'merma'` + `motivo_baja_id`) | Sesión de esfuerzo máximo |
| D2 | Se registra desde la mesa (anular / cancelar con motivo) y desde Mermas (productos sueltos); el listado de Mermas lo muestra aparte | Owner |
| D3 | Sin documento, sin IVA, sin montos fiscales congelados: el registro es el respaldo | Sesión de esfuerzo máximo (ADR-010) |
| D4 | El crédito fiscal de los insumos se mantiene (Oficio 1.280/2007): nada que construir | Sesión de esfuerzo máximo |
| D5 | Lo que se lleva un empleado, y lo del dueño, va como cortesía: el motivo dice *"(dentro del local)"* y su ayuda lo explica | Owner |
| D6 | Balde propio *"Personal"* en el reporte de varianza | Sesión de esfuerzo máximo |

## 3. Diseño

### 3.1 El tipo y el motivo fijo

- `TipoMotivoBaja.CONSUMO_PERSONAL = 'consumo_personal'` (enum de Postgres `tipo_motivo_baja`).
  `synchronize` agrega el valor; **se mide** el arranque sobre una base sembrada por `main` con
  motivos y anulaciones de los tres tipos de hoy, y que las filas conserven su tipo.
- Un octavo motivo fijo: **"Comida del personal (dentro del local)"**, tipo `consumo_personal`. Lo
  siembran el alta de tenant (`MOTIVOS_BAJA_FIJOS`) y el seeder (IDs `…440460` París y `…440461`
  Falabella, del rango 460-464 que reservó la orquestadora).
- **Qué descuenta, en un solo lugar.** El predicado `merma || cortesia` está copiado tres veces en
  `salones.service.ts`. Con un tipo más, pasa a ser una función junto al enum,
  `tipoMotivoBajaDescuenta(tipo)`, que dice `true` para `merma`, `cortesia` y `consumo_personal`.
- **La ayuda** (D5), en un solo texto del front que usan el modal de anulación, la pantalla de
  Mermas y la de configuración: *"Solo lo que el personal come dentro del local. Si se lo lleva, o
  si lo consume el dueño, regístralo como cortesía: es retiro y paga IVA."*

### 3.2 La mesa (`SalonesService`)

- `anularLinea` y `cancelarConMotivo` aceptan el tipo nuevo por el mismo camino que la cortesía:
  descuentan con `consumirLineaAnulada` (receta/combo/opciones expandidas) y escriben `motivo 'merma'`
  + `motivo_baja_id` + `cuenta_linea_anulacion_id`. **No calculan baldes**: `monto_afecto`,
  `monto_exento` y `monto_impuestos` quedan en `NULL` (D3), igual que merma y `no_elaborado`.
- La regla de la serie a medias de `cancelarConMotivo` vale igual, porque cuelga de "descuenta".
- La precuenta imprime lo anulado como personal en $0 con su etiqueta, como merma y cortesía: salió
  de cocina.

### 3.3 Mermas (`POST /mermas`, `GET /mermas`)

- `POST` acepta motivos de tipo `merma` **y** `consumo_personal`. Rechaza `cortesia` y
  `no_elaborado` como hoy. Mismo movimiento, misma valorización.
- `GET` suma el filtro `tipo` (`merma` | `consumo_personal`, por defecto `merma`). La condición
  que hoy excluye todo lo que no es merma pasa a ser *"el tipo pedido"*, en las dos consultas
  (COUNT y página). Sin `tipo`, la respuesta es exactamente la de hoy.
- `resumen` (el "Pérdidas" del Inicio) **no cambia**: sigue siendo solo `merma`.
- Pantalla: un selector *Mermas / Comida del personal* arriba del listado. Cambia qué se lista,
  qué motivos ofrecen el filtro y el formulario, el título del botón y del formulario, el toast, y
  la columna "Costo perdido", que en la vista de personal se llama "Costo". En esa vista aparece
  la ayuda de D5.

### 3.4 Reporte de anulaciones

- `porTipo` agrupa por `mb.tipo`, así que aparece un grupo `consumo_personal` sin tocar esa
  consulta, con `fiscal: null` y costo valorizado como el de merma (la consulta del % por garzón
  sí cambia: ver el agregado de abajo). El filtro `?tipo=` lo acepta por el
  `IsEnum`.
- Pantalla: cuarta tarjeta *"Comida del personal"* (sin línea de IVA), cuarta opción en el filtro
  de tipo y la etiqueta en la fila.
- **Agregado tras la revisión independiente** (decidido por la Sesión de esfuerzo máximo, derivado
  de las decisiones del owner del 2026-10-04 y del 2026-09-27): la comida del personal sale del %
  por garzón (numerador y denominador, aunque se filtre por su tipo) y del bloque "Pérdidas" del
  Inicio (`resumen-negocio` filtra su grupo).

### 3.5 Reporte de varianza

- Predicado nuevo `P.PERSONAL` (`mv.motivo = 'merma' AND mv.tipo = 'salida' AND mb.tipo =
  'consumo_personal'`), en las tres consultas que clasifican: cantidades, plata de la fila y plata
  del resumen.
- Columna `personal` en la fila y en el resumen. Entra en `porBuckets` del residuo, para que
  «Otros» siga en cero. **No** entra en "plata perdida": es un gasto de la operación, no una
  pérdida.
- Pantalla: columna *"Personal"* y su total, sin entrar en el gráfico de pérdidas.

### 3.6 Configuración de motivos

Cuarta opción en el selector de tipo, *"Comida del personal"*, con la ayuda de D5 cuando está
elegida.

## 4. Fuera de alcance (con su lugar)

- **Que el kardex deje de decir "costo perdido" para lo que no es merma** (cortesía y personal):
  entrada nueva en `pendientes.md`, decidida así por la Sesión de esfuerzo máximo.
- **El documento "no afecta"**, si algún día se pide: lo emite el frente de emisión leyendo estos
  registros (D3).
- Una pantalla "Consumo interno" que expanda recetas sin pasar por una mesa: descartada por el
  owner (D2).

## 5. Qué lo fija

- Unit: el predicado nuevo; `anularLinea` y `cancelarConMotivo` con `consumo_personal` (descuenta,
  sin consulta de baldes, baldes `NULL`); `POST /mermas` acepta personal y rechaza cortesía; el
  filtro `tipo` de `GET /mermas`; `porTipo` del reporte; varianza con el balde nuevo.
- E2E contra Postgres: anular un plato con receta como personal (descuenta los ingredientes,
  `monto_impuestos` en `NULL`, aparece en el reporte con `fiscal: null`); mermas de personal (no
  aparece en el listado por defecto ni en el resumen del Inicio, sí con `?tipo=consumo_personal`);
  varianza con una salida de personal dentro de la ventana (balde `personal` con su cantidad,
  «Otros» en cero).
- Mutantes: sacar `consumo_personal` del predicado de descuento; calcular baldes para él; dejar el
  filtro de Mermas en `merma` fijo; sacar `personal` del residuo de varianza.
- Arranque medido sobre una base de `main` con datos (condición de la orquestadora).
- Playwright entero.
