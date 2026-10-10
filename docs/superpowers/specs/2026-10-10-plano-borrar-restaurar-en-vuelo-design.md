# Diseño: el plano no saca la mesa que esta pantalla borró y restauró con el guardado en vuelo

**Date**: 2026-10-10
**Owner**: orquestadora (encargo); el cierre lo eligió el frente (decisión técnica delegada)

## Problema

`sacarMesasNoEscritas` (`frontend/app/pages/configuracion/salones.vue`) saca del plano las mesas
que el guardado mandó, el servidor no escribió y la pantalla todavía tiene vivas. Supone que la
única causa es otra sesión. Si **esta** pantalla borra y restaura la mesa mientras el `PATCH`
viaja y el `UPDATE` corre con la mesa borrada, la respuesta no la trae, la pantalla la tiene viva
otra vez y la saca, con un aviso de "otra sesión" falso. Queda fuera del plano hasta recargar.

**Medido** (vitest, `PATCH` retenido): se reproduce. Y tiene un **gemelo** en la misma pantalla:
borrar y restaurar el **salón** con el guardado en vuelo saca todas sus mesas (el `UPDATE` no
escribe ninguna).

## Los dos cierres

1. **Serializar**: que borrar y restaurar esperen al guardado en vuelo.
2. **Marcar**: cada guardado en vuelo lleva un set con los ids que esta pantalla borró o
   restauró mientras viajaba, y `sacarMesasNoEscritas` no los saca.

## Decisión: marcar el borrado y la restauración

- **No agrega `await`.** Serializar mete una espera al principio de cuatro funciones
  (`eliminarMesa`, `restaurarMesaSeleccionada`, `eliminarSalon`, `restaurarSalonSeleccionado`),
  y todo lo que viene después queda leyendo estado tras esa espera: hay que congelar ids y poner
  guards de reentrada que hoy no tienen (`eliminarMesa` y `eliminarSalon` no tienen `loading`,
  y con la espera un doble click manda dos `DELETE`). Es la forma que ya hizo bloquear revisiones
  en esta pantalla y en `salones/index.vue`.
- **La decisión queda en un solo lugar**, `sacarMesasNoEscritas`, que ya es la que decide qué
  sale.
- **No demora al usuario**: confirmar no espera al `PATCH` de otro arrastre.
- **Varios guardados a la vez**: el guardado no se serializa consigo mismo, así que cada uno
  lleva su set y marcar escribe en todos los que estén en vuelo.

**El borrado también marca, y antes del `await`.** La primera versión marcaba solo la
restauración y lo daba por medido porque sacar la marca del borrado dejaba todo verde. Pero eso
solo probaba que ningún caso ejercía la ventana: **mientras viaja el `DELETE`** la mesa sigue
viva en pantalla y la respuesta del guardado la sacaba con el aviso falso de "otra sesión". Lo
encontró la revisión independiente y se midió con el `DELETE` retenido. Por eso el orden importa
en el borrado (un mutante que marca después del `await` lo pone rojo). En la restauración, marcar
después del `await` del POST no cambia ningún caso (medido, mesa y salón): mientras viaja el POST
la mesa todavía figura eliminada y la cubre el filtro. Marcar el salón después del `cargar()`
tampoco pone nada rojo, pero deja saltos de microtarea entre que las mesas reviven y la marca. Se
marca antes del `await` en los cuatro caminos.

Lo que se resigna frente a serializar: el servidor no escribió la posición de esa mesa en
ese guardado (corrió borrada). No se ve distinto en pantalla: el borrado con «Ver eliminados»
recarga, así que la mesa restaurada se dibuja con la posición del servidor.

## Lo que no cambia

- La mesa que **otra** sesión borró sigue saliendo, también en el mismo vuelo en que esta
  pantalla tocó otra (lo fija un caso del spec). La excepción es que esta haya tocado **esa**
  mesa o su salón en el mismo vuelo: la marca no distingue quién la borró, y queda dibujada hasta
  recargar.
- El filtro de mesas vivas del 2026-10-08 se queda: deja en "Mesas eliminadas" la que otra sesión
  borró y una recarga ya trajo como eliminada (su caso del spec lo prueba).
- Sin backend.

## Ventana que no cierra ninguno de los dos

Otra sesión borra y restaura la mesa durante el vuelo: la respuesta no la trae y esta pantalla
la saca con el aviso. El aviso dice algo cierto (otra sesión la borró) y recargar la devuelve.
No es de esta pantalla y no se arregla sin polling.
