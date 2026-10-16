# Criterios de la revisión de UX

Cuatro capas. La primera es propia de Venka; las otras tres adaptan ideas de fuentes públicas
(abajo), escritas en nuestras palabras y ajustadas a nuestras reglas.

## 1. POS (propio)

| Criterio | Cómo se mide |
|---|---|
| **Velocidad del caso común** | Toques del flujo principal. Un ítem simple se agrega en 1 toque; cobrar en efectivo exacto, en ≤ 3 desde el carrito |
| **Lo que se dice en voz alta, grande** | Total, vuelto y "por cobrar" son el texto más grande de su panel; cifras con `tabular-nums` y punto de miles |
| **El dedo, no el mouse** | Objetivos tocables ≥ 44 px en tablet; lo destructivo (quitar, anular) separado de lo frecuente (cantidad) |
| **Nada se repite solo** | Sin reintento automático: falla → avisa → el usuario reintenta (`docs/patterns/frontend.md`) |
| **Nada se cobra dos veces** | Mientras una acción de plata está en curso, el disparador está bloqueado de punta a punta (incluida la impresión) |
| **Lo que está viejo se ve viejo** | Un total recalculándose o fallido se atenúa o avisa; no se muestra como vigente |
| **El estado de la caja a la vista** | Abierta o cerrada, de quién, y el acceso a movimiento y cierre se descubren sin explorar |
| **Confirmación según el alcance** | Lo que toca muchas filas o plata pide confirmación explícita; lo chico, deshacer en un toast |
| **Lenguaje del local** | Tuteo chileno, sin jerga interna ("tercero", "bloqueante", "tenant") en pantalla |
| **Sin regla de negocio inventada** | Billetes rápidos, propina por defecto, categorías, descuentos manuales: se proponen al owner, no se diseñan |

## 2. Heurísticas de usabilidad

Las 10 de Jakob Nielsen, como preguntas sobre la pantalla:

1. **Estado visible:** ¿el usuario sabe qué está pasando (cargando, guardado, cobrado)?
2. **Mundo real:** ¿las palabras son las del local o las de la base de datos?
3. **Control y libertad:** ¿hay salida y deshacer para un error de toque?
4. **Consistencia:** ¿lo mismo se llama y se ve igual en toda la app?
5. **Prevención de errores:** ¿se evita el error antes de que pase (deshabilitar con motivo, confirmar)?
6. **Reconocer antes que recordar:** ¿lo necesario está a la vista?
7. **Flexibilidad:** ¿el experto tiene atajos sin estorbar al nuevo?
8. **Minimalismo:** ¿sobra algo (filas en $0, datos repetidos en cada tarjeta)?
9. **Errores claros:** ¿dicen qué pasó y qué hacer, en palabras del local?
10. **Ayuda:** ¿lo poco frecuente se entiende sin preguntar?

Y tres ejes de crítica visual: **jerarquía** (lo importante, más grande y primero), **carga
cognitiva** (cuántas decisiones pide la pantalla) y **densidad** (ni vacía ni amontonada).

## 3. Reglas de interfaz web

Las *Web Interface Guidelines* de Vercel (~190 líneas): leerlas al revisar con
`curl -s https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` y
reportar las violaciones como `archivo:línea`. Cubren foco, formularios, estados, interacción
táctil, textos y antipatrones.

**Excepciones nuestras, que ganan sobre esa lista:**
- Títulos y botones van con **mayúscula solo inicial** (español), no "Title Case".
- Colores, espaciados y componentes: los de Nuxt UI y `DESIGN-SYSTEM.md`.
- Móvil (~375 px) está fuera de alcance (`docs/PRODUCTO.md`); se revisan 1280 y 768.

## 4. Accesibilidad

WCAG 2.2 AA, medida con `chrome-devtools-mcp:a11y-debugging` cuando la app corre: contraste del
texto (≥ 4,5:1) y de los controles (≥ 3:1), foco visible, todo operable con teclado, nombre
accesible en los botones de solo ícono, nada que dependa solo del color.

## Fuentes

- Jakob Nielsen, *10 Usability Heuristics for User Interface Design* (Nielsen Norman Group).
- `vercel-labs/web-interface-guidelines` y `vercel-labs/agent-skills` (`web-design-guidelines`),
  MIT.
- `pbakaus/impeccable` (Apache-2.0): los ejes de crítica visual.
- `plugin87/ux-ui-agent-skills` (MIT): heurísticas con severidad y revisión sobre capturas.
- `Dammyjay93/interface-design` (MIT): las decisiones de diseño quedan escritas y se respetan
  (acá, en `DESIGN-SYSTEM.md` y la spec de identidad, no en un archivo paralelo).
