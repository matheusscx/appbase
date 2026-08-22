# Tendencia de descuadres por cajero — diseño

**Fecha:** 2026-08-22 · **Estado:** Implementado (2026-08-22) · **Plan:** [`plans/2026-08-22-tendencia-de-descuadres.md`](../plans/2026-08-22-tendencia-de-descuadres.md)

## De dónde sale

Del cierre por descarte de *"Ocultar el resultado post-cierre al cajero"*
([`resueltos.md`](../../agent/resueltos.md)). Descartado el ocultamiento, lo que quedó
nombrado es el agujero real: **el descuadre lo justifica la misma persona que lo produjo y
no lo revisa nadie.** El cajero cuenta, se entera, elige el motivo, escribe la explicación y
cierra. Queda registrado — pero registrado no es revisado: alguien tiene que ir a buscarlo al
historial, y nada le avisa que vaya.

Un cajero que descuadra \$3.000 por turno, siempre para el mismo lado y siempre con el mismo
motivo, atraviesa el flujo entero sin encender nada.

## Qué es y qué no es

**Es** una lectura para el supervisor: por cajero, sobre una ventana de fechas, cuánto
descuadró y **para qué lado**.

**No es**, y conviene decirlo porque son los tres vecinos con los que se confunde:

- **No es el umbral de aprobación** (entrada aparte en [`pendientes.md`](../../agent/pendientes.md)).
  Al contrario: **existe para poder elegir el número del umbral con fundamento.** Hoy nadie
  sabe si un descuadre típico de esta operación es de \$200 o de \$8.000, y a ojo el umbral
  falla de las dos maneras — bajo, y cada turno espera a un encargado que no está; alto, y no
  atrapa nada.
- **No avisa nada** (decisión del owner, ver abajo). Avisar exige un umbral, que es
  justamente lo que todavía no se puede elegir.
- **No toca el flujo de cierre.** Es lectura pura. Después de que el intento del 2026-08-16
  dejara al cajero sin poder cerrar su caja, eso es una propiedad buscada, no una casualidad.

## Decisiones del owner (2026-08-22)

1. **La ve solo el supervisor.** Vive detrás de `Cajas:Leer`; el cajero no ve la propia.
   El razonamiento: mostrarle *"venís -\$3.000 por turno"* es entregarle la calibración
   servida, que es justo lo que el control quiere evitar.
   ⚠️ **Costo aceptado:** el cajero de buena fe que descuadra por un mal método de conteo no
   se entera y no corrige.
   ℹ️ **No contradice lo decidido el mismo día** sobre la revelación al enviar el conteo: eso
   es el **turno en curso** —un dato que el cajero ya tiene—, esto es el **acumulado**, que
   es trabajo hecho.
2. **Solo muestra.** Sin señales, badges ni notificaciones en v1.

## Decisiones de diseño, con su porqué

### La señal es el sesgo, no la magnitud

El cajero de la caja más cargada va a tener más varianza **siempre**, y no por eso es
sospechoso. Un promedio de magnitud marca al más ocupado; lo que delata es descuadrar
**siempre para el mismo lado**. Por eso la fila reporta la **suma con signo** y el **conteo de
cierres con faltante / con sobrante / cuadrados** — 18 de 20 para abajo es la señal, y no hace
falta dividir nada para verla.

### Sin promedio en v1 — y no es pereza

Un promedio de dinero es una **división de dinero**, y este proyecto tiene un invariante
sobre eso (Decimal.js + cuantización a la escala de la moneda con el `modo_redondeo` del
tenant). Meterlo acá arrastra la plomería de moneda/escala a un reporte, para un número que
la suma + los conteos ya hacen legible. Queda como pregunta abierta, no como omisión.

### Efectivo separado del resto, nunca sumados en un número

`cajas.diferencia` es la línea de **efectivo**; `diferencia_total` (el `LATERAL` que ya existe
en `historial`) es la suma de **todas** las líneas del arqueo. La resta da el resto de los
medios.

Van **separados** por dos razones que empujan en direcciones opuestas y las dos importan:

- El robo vive en el efectivo — una tarjeta no se guarda en el bolsillo—, así que mezclar
  medios le mete ruido de otra falla (conciliación de tarjeta) a la señal de sesgo.
- Pero **mostrar solo el efectivo ya fue un bug acá**: `CajaHistorial.vue` documenta que con
  la columna sobre `diferencia` una caja cerrada con −500 en tarjeta *"se veía como +0 acá y
  como −500 al abrir el detalle"*. Por eso se cambió a `diferenciaTotal`.

La salida de las dos: **las dos cifras, en columnas distintas.** El efectivo manda la lectura
de sesgo; el resto queda visible para que ningún descuadre desaparezca de la pantalla.

### Ventana por rango de fechas, con la utilidad que ya existe

`QueryHistorialCajaDto` **no tiene filtros de fecha** (medido) — así que hay que agregarlos, y
van con `bordeFechaSql` / `bordeHastaSql` de
`common/utils/rango-fecha.util.ts`, que ya usan mermas, cobros e inventario. Existen porque
`<= hasta` con fecha pura **se come el día entero** (`cf8396be`); la convención y su tabla
están en `patterns/backend.md` §10b. En el frontend, `AppDateInput`, igual que
`mermas.vue`.

### Vive en el módulo `caja`, no en un módulo `reportes` nuevo

No existe módulo de reportes, y `CLAUDE.md` es explícito: no introducir una arquitectura
nueva para un problema chico. Va como endpoint del `caja.controller.ts` existente.
⚠️ **Es la primera consulta agregada del proyecto** (mermas, el candidato más parecido, no
tiene ningún `GROUP BY`). Si más adelante aparecen tres o cuatro, ahí se discute el módulo —
no ahora.

### Qué cierres cuentan: `diferencia IS NOT NULL`

No se enumeran estados. Un `diferencia` no nulo significa exactamente **"el conteo se
congeló"**, que es la condición que importa, y sobrevive a que mañana se agregue un estado
nuevo. Incluye `cerrada` y `en_conciliacion` — en las dos el descuadre ya ocurrió y ya está
frozen. Excluye `abierta` sola, porque ahí es `NULL`.

Se arrastran de `historial` los dos filtros que no son opcionales: `c.tipo = 'fisica'` (la
caja virtual no se cuenta físicamente) y `c.eliminado_el IS NULL` / `am.eliminado_el IS NULL`.

### Una sola query, sin N+1

`GROUP BY` por `usuario_id` con el `JOIN` a `usuarios` para el nombre, en **una** consulta.
El dato por fila no se resuelve con una query por cajero.

## Contrato

`GET /caja/tendencia?desde=&hasta=` · permiso **`Cajas:Leer`**

⚠️ **Va declarada antes de `@Get(':id')`** (hoy en `caja.controller.ts:196`) o la ruta
literal se la come el parámetro.

Respuesta: una fila por cajero con al menos un cierre congelado en la ventana.

| Campo | Tipo | Qué es |
|---|---|---|
| `usuarioId` | uuid | |
| `usuarioNombre` | string | |
| `cierres` | int | Cierres con conteo congelado en la ventana |
| `efectivoSuma` | string | Suma **con signo** de `cajas.diferencia` |
| `otrosMediosSuma` | string | Suma de `diferencia_total − diferencia` |
| `conFaltante` | int | Cierres con efectivo negativo |
| `conSobrante` | int | Cierres con efectivo positivo |
| `cuadrados` | int | Cierres con efectivo en cero |

Los montos viajan como **string** (convención del proyecto para dinero), no como number.

## Superficie frontend

Página nueva `/cajas/tendencia`, enlazada desde `/cajas` igual que hoy se enlaza
`/cajas/historial`. Tabla ordenada por `efectivoSuma` ascendente — el faltante más grande
arriba, que es lo que el supervisor vino a ver.

**Drill-down gratis:** cada fila navega a `/cajas/historial?usuarioId=<id>`, que **ya
funciona** (`historial.vue` lee `usuarioId` de la query y se lo pasa a `CajaHistorial`). No
hay que construir nada para pasar de la tendencia al detalle.

Colores financieros (verde/rojo) siguiendo el precedente de `CajaHistorial.vue` — es la
excepción documentada del módulo Caja al design system.

⚠️ **Corregido al construirlo (revisión independiente, 2026-08-22):** esa excepción está
acotada por el checker a `app/components/caja/`, no a `app/pages/`. La tabla vive entonces en
**`components/caja/CajaTendencia.vue`** y la página queda fina, exactamente como
`historial.vue` delega en `CajaHistorial.vue`. La primera versión metía los colores en la
página: pasaba el gate solo porque el checker mira neutrales, no rojo/verde.

## Casos borde a cubrir

- **Cajero sin cierres en la ventana** → no aparece. No se inventa una fila en cero.
- **Ventana sin ningún cierre** → lista vacía, con su estado vacío en la tabla.
- **`desde` posterior a `hasta`** → seguir lo que ya hacen mermas/cobros, no inventar.
- **Caja cerrada por otro** (cierre forzado): la fila cuenta para el **dueño del turno**
  (`usuario_id`), no para quien la cerró (`cerrada_por`). El descuadre es del turno.
  ⚠️ Esto merece quedar escrito en la doc de la feature: es la clase de detalle que a los
  seis meses nadie recuerda por qué se decidió así.
- **Cajero soft-borrado** con cierres en la ventana: sigue apareciendo (el hecho ocurrió).

## Preguntas abiertas

1. **¿Promedio con signo?** Requiere resolver la división de dinero (ver arriba). Se puede
   agregar después sin romper el contrato.
2. **¿Ventana por defecto?** La propuesta es 30 días. Si el owner prefiere otra, es un
   cambio de una línea.
3. **¿El cajón importa?** Un cajero que rota entre cajones hoy se agrega en una sola fila.
   Separar por cajón es otra pregunta y no está pedida.
