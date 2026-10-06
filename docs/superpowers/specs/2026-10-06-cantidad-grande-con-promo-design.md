# Spec: una cantidad grande con promo NxM o de precio fijo

- **Status:** Approved (frente lanzado por la orquestadora, sin revisión del documento; lo técnico
  lo decidió la Sesión de esfuerzo máximo y el tope, el owner)
- **Date:** 2026-10-06
- **Origen:** `docs/agent/pendientes.md` § 2, *"Una `cantidad` grande en una línea con promo NxM o de
  precio fijo cuelga el backend de todos los tenants"*.

## Lo medido antes de tocar código

**El evaluador solo** (node sobre `dist`, 1 línea de $1.000; 2x1 = `nxm` `cadaN` 2; combo =
`precio_fijo` de un slot de 2 unidades a $1.500):

| cantidad | nxm | precio_fijo |
|---|---|---|
| 10⁴ | 18 ms | 30 ms |
| 10⁵ | 90 ms | 163 ms |
| 10⁶ | 697 ms, 39 → 499 MB | 1.258 ms, 39 → 503 MB |

**Por HTTP**, `POST /calculo-precios/calcular` con la misma promo 2x1 (backend compilado del
worktree): 10⁶ → 3.961 ms y RSS 317 → 819 MB, con un `GET /auth/me` lanzado durante el pedido
que tardó 3.557 ms. La entrada de pendientes midió 5.190 ms con el mismo pedido en otra corrida.

**El evaluador explica menos de la mitad.** El contrato devuelve una `AplicacionPromo` por grupo o
combo: 10⁶ unidades son 500.000 aplicaciones, y cada una es una traza en el motor, cuantizada aparte,
y una fila de `ventas_promociones` en la venta. El costo es O(cantidad / cadaN) en las tres capas,
y con "salida idéntica" no se puede bajar de ahí.

**Y la venta se cae mucho antes de colgarse.** `POST /ventas`, 2x1, una línea: 16.383 unidades →
201; **16.384 → 500**. `manager.save(VentaPromocion, filas)` arma un único INSERT con 8 parámetros
por fila, y el protocolo de Postgres cuenta los parámetros del bind en 16 bits: 8.192 filas × 8 =
65.536 da la vuelta (`bind message supplies 0 parameters, but prepared statement "" requires
65536`). Detrás de ese desborde hay otro: `ventas_promociones.aplicacion` es `smallint`, y una
promo con más de 32.767 aplicaciones en una venta no cabe.

## Decisiones

1. **Evaluador por lotes (técnica, Sesión de esfuerzo máximo).** `nxm` y `precio_fijo` cuentan
   unidades por línea en vez de explotarlas. Las unidades de una línea son indistinguibles para el
   comparador, así que ordenar lotes da el mismo orden que ordenar unidades. Dentro de un combo, la
   suma sigue siendo unidad por unidad. Con 20 cifras significativas, sumar 7 veces un precio no
   da lo mismo que multiplicarlo por 7. Los grupos y combos con los mismos tramos que el anterior
   reusan la plata ya calculada. **Condición de entrada:** un test diferencial con el evaluador de
   `6cecf160` adentro como oráculo.
2. **No se agregan aplicaciones iguales en una** (Sesión de esfuerzo máximo). Sería un frente de
   motor y congelado: cambia filas de `ventas_promociones`, ticket y congelado, aunque no la plata
   (k × q(m) da el mismo total). **Se abre solo si el tope resulta insuficiente para algún negocio.**
3. **Tope: 99.999 unidades (o kilos) por venta o por mesa** (owner, 2026-10-06, por
   AskUserQuestion de la Sesión de esfuerzo máximo. Primero con los tiempos de `/calcular`
   —0,1 / 0,5 / 5 s—. Después se le volvió a preguntar con la venta guardada en el peor caso
   —99.999 con 2x1: 2,2 s para la caja que cobra, menos de 0,3 s para el resto— y mantuvo
   99.999 sobre 9.999. También descartó 999.999). Es por venta y no por línea porque el costo y la numeración de aplicaciones dependen
   de las unidades de toda la venta: 500 líneas de 9.999 se cuelgan igual. Se aplica:
   - en el borde, a `cantidad` de los DTOs que la reciben (cada línea sola tampoco puede pasar);
   - en el service, a la suma de la venta, antes de evaluar: un único punto en
     `CalculoPreciosService.calcular`, por donde pasan `/calcular`, la venta del POS, el online y
     el cierre de una cuenta;
   - en las escrituras de una cuenta que suben su total: agregar una línea, cambiarle la cantidad
     y fusionar dos cuentas.
4. **INSERT por tandas** (Sesión de esfuerzo máximo): `ventas_promociones` y sus gemelos
   (`ventas_descuentos`, `ventas_recargos`, `ventas_impuestos`) se guardan con `chunk`, con una
   constante con nombre y su porqué. Los gemelos no tienen e2e propio: harían falta más de 8.192
   filas de reglas, del orden de 500 líneas × 17 reglas. El hueco se declara.
5. **`aplicacion` pasa a `integer`.** Con el tope del owner el caso es alcanzable por HTTP: 65.536
   unidades con 2x1 son 32.768 aplicaciones. Sin datos productivos, es cambiar la entity y resetear.

## Fuera de alcance

- La agregación de aplicaciones (decisión 2).
- B2–B6 de pendientes (topes de otros DTOs), salvo lo que se mida del loop por unidad de los combos
  de ítems.
