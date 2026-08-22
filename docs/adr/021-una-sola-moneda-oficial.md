# ADR-021: Una sola noción de moneda oficial — se elimina `tenant_moneda.es_default`

**Status**: Accepted
**Date**: 2026-08-21

## Context

**ADR-005** decidió que la moneda oficial se deriva de `pais.moneda_oficial_id` y **no la elige
el tenant** —y por eso deliberadamente no puso una columna `es_oficial` en `tenant_moneda`—.
Pero la tabla sí tenía `es_default`, documentada como *"moneda preseleccionada en el UI"*, con
su endpoint `PATCH /monedas/:monedaId/default`.

Las dos se leían como "la moneda oficial del tenant" y **no eran lo mismo**. Nacían coincidiendo
(el alta de tenant siembra la del país como default) y divergían en cuanto un admin usaba ese
endpoint, cosa que la pantalla ofrecía con una estrella.

Al mapear todos los consumidores (2026-08-21) apareció que `es_default` **no hacía el trabajo de
presentación que su nombre prometía**: el orden de la lista de monedas sale de
`ORDER BY es_oficial DESC` en `findMonedas`, y ningún componente del frontend ordenaba por él.
Lo que sí hacía era decidir plata, por un camino distinto al del resto del sistema:

| consumidor | leía | decidía |
|---|---|---|
| `ventas.service` | `es_default` | escala de la venta, moneda estampada en la cabecera, moneda del pago |
| `MonedasService.decimalesOficiales` | `es_default` | escala del motor y el rechazo con 400 del borde HTTP |
| `LiquidacionPropinasService` | `pais.moneda_oficial_id` | decimales del reparto de propinas |
| `findMonedas` (tasas) | `pais.moneda_oficial_id` | a qué moneda se convierten los totales |

Medido: un tenant chileno que marcaba UF como predeterminada seguía cobrando en pesos —la
conversión multiplica por `valor_del_dia` y a la moneda del país se le fuerza `1`— pero
**cuantizados a 4 decimales**. Un ítem de 4,5674 UF daba un total de `222.085,7822` pesos en
vez de `222.086`. Es el mismo agujero que el frente de redondeo de plata había cerrado dos días
antes, reabierto desde un ajuste de orden de una lista.

La divergencia ya había costado código defensivo: `CobroModal.vue` y `salones/index.vue`
redondeaban la propina sugerida al `Math.min` de las dos escalas, con un comentario que decía
que unificarlas era decisión del owner.

## Decision

**La única noción de moneda oficial es `pais.moneda_oficial_id`.** Se elimina la columna
`tenant_moneda.es_default`, su endpoint y todos sus consumidores.

`ventas.service` pasa a resolver la moneda y la escala por el país, y a forzar `1` a la tasa de
esa moneda al armar su mapa —como ya hacía `findMonedas`—, para que los dos caminos no puedan
armar mapas distintos para la misma venta.

### Por qué eliminar y no acotar

Acotar el campo a "solo presentación" habría dejado una columna que **no presenta nada**: el
orden ya sale de `es_oficial`. Habría que haberle inventado un trabajo para justificarla. Y la
ambigüedad —dos campos que se leen igual— es la causa raíz de este defecto, no un efecto
lateral: mientras exista, cualquier código nuevo puede volver a preguntarle la moneda al campo
equivocado, que es exactamente lo que pasó.

El proyecto **no tiene datos productivos**, así que eliminar la columna es cambiar el esquema y
resembrar; no hay backfill ni deprecación que diseñar.

## Consequences

### Positive

- "Oficial" nombra **una sola cosa** en todo el sistema. La escala de una venta, la moneda que
  se le estampa, el rechazo del borde y los decimales del reparto de propinas salen de la misma
  fuente, por construcción y no por coincidencia de datos.
- Desaparecen los dos `Math.min` defensivos del frontend y el comentario de `suscripciones` que
  documentaba la divergencia como aceptada.
- Un estado que producía plata mal cuantizada deja de ser alcanzable: no hay endpoint que lo
  produzca.

### Negative

- El tenant pierde la posibilidad de elegir qué moneda aparece primero. Hoy **no la tenía en los
  hechos** —el orden salía de `es_oficial`— así que la pérdida es del botón, no de la función.
  Si el producto quiere esa preferencia, hay que construirla como tal: un campo de orden que
  gobierne el `ORDER BY`, sin tocar ninguna cuenta.
- El formulario de ítems preselecciona la moneda oficial en vez de la que el tenant hubiera
  marcado.

### Neutral

- La columna desaparece por `synchronize`; `startup-pos.sql` se actualiza como documentación.
