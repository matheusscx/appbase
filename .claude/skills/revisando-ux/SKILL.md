---
name: revisando-ux
description: Usar al revisar, auditar o mejorar la experiencia de uso (UX/UI) de una pantalla o tipo de pantalla del frontend de Venka —punto de venta, mesas, caja, inventario, compras, configuración—, o cuando el owner pide que una vista "se vea profesional", "sea más rápida de usar" o "se entienda mejor", también con apuro (una demo, un video).
---

# Revisando UX

## Qué es

Una revisión de UX mide si **quien de verdad usa la pantalla** hace su tarea **rápido y sin
equivocarse**, no si se ve linda. Entrega hallazgos con evidencia; **no arregla en la misma
pasada**: el owner elige qué entra y cada arreglo va por el flujo normal del repo.

Complementa a `frontend-design` y `nuxt-ui` (que el `CLAUDE.md` exige en toda tarea de
frontend): esas dicen cómo construir; esta, qué tan bien funciona. Si chocan, mandan los tokens
semánticos, `frontend/docs/DESIGN-SYSTEM.md` y la spec de identidad vigente
(`docs/superpowers/specs/*identidad*`).

Criterios detallados: `criterios.md` en esta carpeta.

## El recorrido (obligatorio, en este orden)

1. **Quién y para qué.** Nombra el rol que usa la pantalla (cajero, garzón, encargado, admin) y
   su tarea principal en una frase. La revisión se hace **con ese rol**, no con admin: admin tapa
   los 403 y los botones deshabilitados por permiso.
2. **El flujo principal, paso a paso.** Escribe la tabla de pasos del camino feliz (en el POS:
   buscar → agregar → ajustar → cobrar → después de cobrar), con **cuántos toques** cuesta cada
   uno. Un paso que se puede repetir con el carrito lleno (cobrar dos veces, enviar dos veces) es
   un hallazgo P0.
3. **La matriz de estados.** Para cada paso, revisa estas filas y escribe qué pasa en cada una:

   | Estado | Pregunta |
   |---|---|
   | Vacío | ¿Dice qué hacer, y distingue "no hay nada" de "tu búsqueda no encontró nada"? |
   | Cargando | ¿Se nota, o la pantalla muestra datos viejos como si fueran actuales? |
   | Error | ¿Dice qué pasó y qué hacer, sin reintentar solo? |
   | Sin permiso / deshabilitado | ¿Dice por qué no se puede? |
   | Dato inválido | ¿El error aparece junto al campo? |
   | Éxito | ¿Queda a la vista lo importante (total, vuelto, folio), o solo un toast que se va? |
   | Tablet 768 px y escritorio 1280 px | ¿Lo principal sigue a la vista sin scroll? |
   | Dedo | ¿Los objetivos tocables miden ≥ 44 px y lo destructivo está separado? |
   | Teclado y lector | ¿Se llega con Tab, hay foco visible y nombre accesible? |

4. **Las cuatro capas de `criterios.md`**, todas: POS, heurísticas, reglas de interfaz y
   accesibilidad. La capa 3 exige **leer las reglas de Vercel desde su URL** en cada revisión, con `curl -s <url>`
   (WebFetch devuelve un resumen, no el texto literal);
   si no se pudo, el alcance lo dice y las violaciones de esa capa quedan pendientes.
5. **Evidencia.** Con la app corriendo: capturas a 1280 y 768 con el rol del paso 1
   (`./scripts/entorno.sh stack` + un spec de Playwright que haga el login; nunca tipear
   credenciales), y medidas reales (px de los botones, contraste con `chrome-devtools-mcp:a11y-debugging`).
   Sin la app corriendo, cada hallazgo lleva **confianza: código**.

## La salida

Un documento con estas partes, en este orden:

1. **Alcance:** pantalla, rol, cómo se revisó (app corriendo o solo código) y qué capas de
   criterios se aplicaron.
2. **El flujo:** la tabla de pasos con sus toques.
3. **La matriz de estados:** una tabla con los pasos del flujo en las filas y los nueve estados en
   las columnas. Cada celda dice `ok`, el número del hallazgo que lo cubre, o `n/a` con el motivo.
   Una celda vacía es una revisión sin terminar.
4. **Hallazgos**, una tabla:

   | # | Severidad | Confianza | Dónde (`archivo:línea`) | Qué pasa (escena concreta) | Propuesta | Decide |
   |---|---|---|---|---|---|---|

   - **Severidad:** P0 plata o datos en riesgo (cobro duplicado, total viejo cobrable) · P1 frena
     la tarea principal · P2 la hace lenta o confusa · P3 pulido.
   - **Confianza:** medido (captura o medida) · código.
   - **Decide:** agente (presentación, copy, accesibilidad) · owner (cualquier regla de negocio:
     propinas, billetes rápidos, categorías, descuentos).
5. **Lo que está bien** y no hay que tocar.
6. **Orden sugerido:** P0 primero y como frente propio; después lotes por componente.

Todo conteo ("24 textos en voseo") lleva el comando con que se contó.

## Bajo presión ("para el video de mañana", "en una hora")

- **Si el owner pide los cambios ya hechos, igual va primero el recorrido y la tabla.** El código
  viene después, y solo para hallazgos que decide el agente (presentación, copy, accesibilidad).
- **Un P0 va primero aunque te hayan pedido estética.** Se reporta arriba de todo y se propone
  como frente propio; no se esconde en una lista de pulido.
- **Un selector de un test no es razón para dejar una UX peor.** Si la propuesta mejora la
  pantalla, va igual, con la lista de specs que hay que actualizar. "No lo cambio porque el e2e
  busca el texto exacto" es la excusa que esta regla prohíbe: el test se actualiza, la UX no se
  achica.
- **Todo texto nuevo va en tuteo chileno** ("Agrega", no "Agregá") y con mayúscula solo inicial,
  aunque el texto que reemplaza esté en voseo.
- **Las decisiones de identidad ya tomadas no se reabren de pasada:** paleta, fuentes dentro de la
  app, sin dependencias nuevas. Si una propuesta choca con la spec, se pregunta.
- **Un atajo de teclado no reemplaza un toque:** en tablet no hay teclado. Primero el botón grande.

## Señales de que te estás saliendo

- Revisaste como admin.
- No escribiste la tabla de pasos, o la matriz de estados tiene celdas vacías.
- Descartaste una mejora porque un test busca el texto o la estructura de hoy.
- Un hallazgo dice "se ve mal" sin escena ni medida.
- Propusiste `font-mono`, colores crudos, Google Fonts o `--ui-primary` a mano.
- Escribiste código del arreglo antes de que el owner eligiera.
