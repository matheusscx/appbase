# Feature: Módulo de reportes

**Status**: Complete (primer reporte: [varianza](./reporte-varianza.md))
**Last Updated**: 2026-09-21

---

## Overview

### Qué es

El lugar donde nace **todo reporte de negocio nuevo**: backend en `backend/src/modules/reportes/`,
pantallas en `frontend/app/pages/reportes/`, y una entrada "Reportes" en el menú que lleva a un
índice con una tarjeta por reporte que el usuario puede ver.

### Por qué existe

Hasta el 2026-09-19 la app **no tenía dónde poner un reporte**: quince endpoints que agregan o
listan para analizar, repartidos en nueve módulos, cada uno con el criterio de quien lo escribió
(mapa en la spec, § 1). El módulo fija ese criterio **hacia adelante**.

### Alcance

- Incluido: el módulo, su menú e índice, los compartidos `AppRangoFechas` y `AppGrafica`, y el
  primer reporte (varianza).
- **No incluido, por decisión del owner:** mudar los reportes que ya existen. *"El módulo nace solo
  con los reportes nuevos. No se muda nada ahora."* Mudar cuesta rutas, pantallas y riesgo sobre
  código que funciona. Los candidatos están en `docs/agent/pendientes.md`.
- No incluido: exportar (no existe en ninguna pantalla de la app).

Spec: [`2026-09-19-modulo-reportes-varianza-design.md`](../superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md).

---

## Qué es un reporte, y qué no

La línea la puso el owner: *"el módulo reporte es más de negocio que de operación"*.

- **Negocio → es un reporte.** Lo mira el dueño o el encargado para entender cómo va el local y
  decidir: mira hacia atrás sobre un rango, **agrega** y compara.
- **Operación → no es un reporte**, aunque tenga filtro de fecha. Lo mira quien está haciendo la
  tarea ahora, para actuar (buscar una boleta, ver qué se movió, aprobar un cierre). Se queda en su
  módulo.
- **La portada tampoco.** El dashboard de inicio es la foto de hoy; lo que corresponde es que sus
  tarjetas enlacen al reporte que profundiza cada número, cuando exista.

La clasificación de los quince que ya existen (ocho de operación, cinco de negocio, dos de portada)
está en la spec, § 3.3.

---

## Cómo se agrega un reporte

**Backend** — una carpeta por reporte dentro de `reportes/`, registrada en `reportes.module.ts`:

| Aspecto | Regla |
|---|---|
| Rutas | `GET /reportes/<slug>` (listado paginado) y `GET /reportes/<slug>/resumen` (agregados). Estáticas antes que las de param |
| Permiso | **un `modulo_app` propio** (`url: '/reportes/<slug>'`) con permiso `Leer`, `@RequiresPermiso` en cada ruta. No hay un `Reportes:Leer` general: el guard solo sabe hacer **O**, y uno general le mostraría el reporte de márgenes de mañana al encargado de bodega que hoy ve la varianza |
| El día | `bordeFechaSql` / **`bordeHastaSql`** (inclusivo del día; lo hace cumplir una invariante) |
| Rango | opcional en el listado (pagina); **obligatorio y con tope de 366 días** en el resumen, que corre sin `LIMIT` |
| Plata | `cantidad × costo_unitario` por `items.moneda_id`, **nunca convertida**, con bandera cuando falta el costo |
| DTO de rango | cada reporte declara el suyo. Sube a un DTO compartido cuando exista el **segundo** consumidor, no antes |

⛔ **Un `modulo_app` sin su fila en `tenant_modulos` da 403 hasta al admin del tenant**
(`rbac.service.ts`): el borde es comercial y también aplica al rol fijo. Es el paso que más fácil se
olvida, y el síntoma —*"no me deja entrar a mí, que soy el dueño"*— no apunta al seed. El menú y la
pantalla usan `esAdmin || can(...)` como el resto de la app, así que **no** lo detectan: el admin
ve la entrada y recibe el 403 recién al cargar.

**Frontend:**

- La pantalla va en `pages/reportes/<slug>.vue`, con
  `definePageMeta({ middleware: ['auth', 'permiso'], permiso: '<Modulo>:Leer' })`.
- **El reporte se agrega al catálogo de `composables/useReportes.ts`**, no al menú a mano: esa lista
  alimenta a la vez la entrada "Reportes" (visible si el usuario ve al menos uno) y las tarjetas del
  índice, y así no se desincronizan.

## Lo compartido

Vive en la **raíz de `app/components/`**, no dentro de `reportes/` (decisión del owner): una
pantalla vieja tiene que poder usarlo sin mudarse de módulo.

| Componente | Contrato | Detalle |
|---|---|---|
| `AppRangoFechas` | `v-model:desde` / `v-model:hasta`, `YYYY-MM-DD \| null`; `qa`. Trae `DiaNegocioNota` y rechaza el rango invertido sin emitir | `docs/patterns/frontend.md` § 7.1 |
| `AppGrafica` | `series` (nombre, token de color, valores string), `categorias`, `formato`, `cargando` / `vacio` / `fallo` | ADR-027 |

⛔ **La gráfica acompaña a una tabla y nunca es la fuente de verdad**: el número exacto vive en la
tabla de la misma pantalla, y si la gráfica no monta, la pantalla sigue sirviendo. Sus datos salen
del `/resumen` del mismo reporte, nunca de una ruta aparte.

Ninguna pantalla vieja se migró a estos componentes: queda disponible, nada más.
