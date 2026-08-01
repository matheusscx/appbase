# Diseño: papelera — restaurar entidades eliminadas

**Status**: Draft
**Owner**: Cesar Matheus
**Date**: 2026-07-31

---

## Contexto

El caso de uso que lo motivó, en palabras del owner: *"siempre hay usuarios que borran
las cosas y después están llorando para que se las repongan"*. Hoy no hay forma de
reponerlas: el dato está, pero no hay puerta.

**Lo medido antes de diseñar:**

- **88 de 99 tablas ya tienen `eliminado_el`** y toda lectura filtra `eliminado_el IS
  NULL` (invariante 3). Para casi todo, el dato borrado **ya está en la base**.
- **No existe ni un endpoint de restaurar** en todo el backend. Los dos únicos "revivir"
  (`roles.service.ts:150`, `tenants.service.ts:319`) son internos e idempotentes, no una
  función de usuario.
- **`eliminado_el` es solo un timestamp**: no hay `eliminado_por` en ninguna tabla. Se
  sabe cuándo, nunca quién.
- **27 de 29 índices únicos son parciales** (`WHERE eliminado_el IS NULL`). Eso hace que
  borrar y recrear con el mismo nombre funcione — y es exactamente lo que puede hacer
  fallar una restauración, si alguien ocupó el lugar mientras tanto.
- **Las 11 tablas sin `eliminado_el`** son: las 5 de extensión de `item` (1:1, siguen al
  padre), `movimiento_inventario_detalle` (kardex inmutable, ADR-007), dos de config
  (`roles_permisos_modulos`, `tenant_formula_precio`) y las 3 puentes puras de reglas de
  precio (`item_impuestos`, `item_recargos`, `item_descuentos`).
- **27 endpoints `DELETE`**, todos de catálogo o configuración. No hay `DELETE` sobre
  ventas, pagos, movimientos de inventario ni cajas: lo transaccional no es borrable por
  el usuario.

**El hallazgo que hace viable la papelera de ítems:** `items.remove()` **no toca**
`item_impuestos` / `item_recargos` / `item_descuentos`. Los `DELETE` físicos de esas
puentes viven en `update()` (`items.service.ts:1615`, `:1627`, `:1639`), en el patrón
"borro todo y reinserto". Restaurar un ítem devuelve **sus impuestos, descuentos y
recargos intactos**.

> Nota: la entrada de `pendientes.md` cita esas líneas como 1559/1571/1583. Las líneas
> derivaron; el hecho no cambió.

**Y `remove()` ya bloquea** borrar un ítem que sea ingrediente de una receta, componente
de un combo u opción de un grupo modificador (`obtenerUsoItem`). La papelera nunca va a
contener algo cuya restauración rompa esas relaciones.

## Decisiones del owner

1. **Alcance: solo borrados.** No se revierten ediciones. No se construye bitácora de
   "quién cambió qué" en esta versión.
2. **Forma: "ver eliminados" por listado**, no una papelera central con tabla paralela.
   Lee la tabla real, así que no puede desincronizarse.
3. **Se agrega `eliminado_por`** para poder mostrar quién borró.
4. **Entran catálogo del negocio y config operativa.** Quedan fuera seguridad/acceso
   (roles, membresías, api-keys de pasarela) y suscripciones/inscripciones de pago:
   restaurarlos devuelve permisos o reactiva cobros, que es una operación con
   consecuencia, no una comodidad.

## Investigación de mercado

Corrida el 2026-07-31 (plantilla: `docs/agent/investigacion-mercado.md`). **Insumo para
cruzar, no verdad a copiar** — donde el mercado dijo A y nuestro modelo dice B, se
documenta abajo cuál ganó.

**Lo que trajo:**

- **Nadie versiona ediciones.** Ninguno de los cuatro POS internacionales revierte un
  precio a su valor anterior. El único ejemplo real de versionado con revert está fuera
  del rubro ([Salesforce Field History
  Tracking](https://help.salesforce.com/s/articleView?language=en_US&id=sf.tracking_field_history.htm&type=5)):
  view-only, tope de 20 campos por objeto (60 con add-on pago), y los campos de texto
  largo registran "fue editado" sin guardar el valor.
- **Archive-first es la postura recomendada.** [Square recomienda archivar en vez de
  borrar](https://developer.squareup.com/docs/catalog-api/archive-catalog-items) porque
  borrar-y-recrear duplica objetos y degrada performance; su `is_archived` se revierte
  self-service. [Toast no permite borrar ítems, solo
  archivar](https://support.toasttab.com/en/article/Using-the-Items-Database), con
  checkbox "Show Archived" + botón Restore en el listado.
- **La postura inversa también existe.** [Lightspeed X-Series no tiene recycle
  bin](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534111725467-Deactivating-or-deleting-products):
  borrar es permanente, y ofrecen *desactivar* como alternativa preventiva.
  [Clover tampoco tiene
  restore](https://community.clover.com/questions/1021/delete-item-from-inventory.html).
- **Nadie hace cascada al restaurar.** [Restaurar un ítem en Toast no lo devuelve a su
  menú](https://support.toasttab.com/en/article/How-do-I-restore-archived-items-to-Toast-Retail)
  — hay que reasignarlo a mano. En Square y Clover, borrar una categoría deja los
  productos huérfanos, no los bloquea. El patrón es universal: **huérfano tolerado +
  reasignación manual**.
- **Ausencia consistente: ningún producto documenta ventana de retención ni purga
  automática** (5 productos relevados, internacionales y chilenos).
- **Audit log es una feature separada.** [Lightspeed tiene una Audit Log Events API
  read-only](https://x-series-api.lightspeedhq.com/reference/getauditlogevents) con
  `data`/`old_data`, sin botón de revert. Ningún producto relevado combina papelera +
  audit log + versionado.
- **Chile:** [un DTE aceptado no se borra, se anula con nota de
  crédito](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm),
  en el mismo período tributario o el siguiente. Conservación obligatoria: 3–6 años por
  el [art. 17 del Código Tributario](https://leyes-cl.com/codigo_tributario/17.htm), 10
  años por el [art. 44 del Código de
  Comercio](https://www.leyes.io/comercio/codigo-comercio-articulo-44-conservacion).
  [Nubox solo permite eliminar una factura en estado
  borrador](https://help.nubox.com/es/articles/4811864-puedo-eliminar-una-factura); una
  vez enviada al SII, se anula con NC. [Bsale tiene papelera para productos y
  clientes](https://ayuda.bsale.app/support/solutions/articles/151000185833-pantalla-de-resumen-de-productos-y-servicios),
  y su API limita el `DELETE` de documentos a los **no** electrónicos.

**El cruce contra nuestro código:**

| Lo que dice el mercado | Lo que ya tenemos | Qué gana |
|---|---|---|
| Archivar, no borrar | Soft delete transversal por invariante 3 | Coincide — ya estamos ahí, falta el botón |
| Sin cascada al restaurar | — | Se adopta (ver decisión **c**) |
| Sin ventana de retención | Soft delete es para siempre | Coincide — no se diseña purga |
| Versionar ediciones es caro y raro | — | Se descarta, fuera de alcance |
| DTE no se borra, se anula con NC | ADR-010 congela el hecho fiscal; nunca `DELETE` físico | Coincide — ya cumplimos |
| Kardex: sin revert | ADR-007 compensa con movimiento contrario | Coincide — el kardex queda fuera |

**Marcado como inferencia del investigador, no fuente:** que "catálogo vs transaccional"
sea la línea explícita del rubro (es un patrón observado cruzando productos, ninguno lo
dice en esos términos), y que no exista norma del SII sobre logging de operaciones
internas. La segunda no nos afecta: ADR-010 ya nos deja del lado seguro.

**No verificable:** Toteat y Defontana no publican nada sobre papelera ni historial de
catálogo. La papelera de Bsale se leyó por snippet indexado, no por lectura directa (su
centro de ayuda está detrás de login).

## Diseño

### Alcance: 16 entidades

**Catálogo del negocio (7):** `items`, `categorias`, `descuentos`, `recargos`,
`impuestos`, `grupos_modificadores`, `terceros`.

**Config operativa (9):** `cajones`, `garzones`, `turnos`, `salones`, `mesas`,
`impresoras`, `causas_merma`, `motivo_diferencia_caja`,
`motivo_diferencia_inventario`.

### Esquema

`eliminado_por UUID REFERENCES usuarios(usuario_id)`, **nullable**, en las 17 tablas del
alcance. No en las 88 — una columna en tablas cuyo borrado nadie puede deshacer es peso
muerto.

Nullable porque las filas ya borradas no lo tienen y porque el seeder borra sin usuario.
No hay backfill: el proyecto no tiene datos productivos, se cambia el esquema y se
resetea.

`type: 'uuid'` explícito en la entity (ADR-004, ya lo fuerza un test + CI).

**Dos familias de borrado conviven hoy, y el plan tiene que respetarlas** (medido):

- **`softDelete()` de TypeORM** — `categorias`, `descuentos`, `recargos`, `impuestos`,
  `terceros`, `cajones`, `garzones`, `turnos`, `impresoras`, `salones`, `mesas`. 82
  entities declaran `@DeleteDateColumn`, así que las lecturas ya excluyen lo borrado
  sola, `withDeleted: true` lo incluye y **`restore()` existe nativo**.
- **SQL crudo `eliminado_el = NOW()`** — `items`, `grupos_modificadores`,
  `causas_merma`, `motivo_diferencia_caja`, `motivo_diferencia_inventario`.

`softDelete()` no puede escribir `eliminado_por` en la misma sentencia. En esa familia el
borrado pasa a ser un `UPDATE` que setea las dos columnas juntas, o un `update()` previo
seguido del `softDelete()` dentro de la misma transacción — nunca dos escrituras sueltas
que puedan quedar a medias.

### API

Por cada recurso del alcance:

- `POST /<recurso>/:id/restaurar` → 201 con la entidad restaurada (default de Nest
  para un `POST`; ninguno de los 16 lo pisa con `@HttpCode(200)`). **Mismo guard
  que el `DELETE` del mismo recurso** — no abre permisos nuevos ni inventa un
  permiso propio.
- El `GET` de listado existente acepta un query param booleano para incluir los
  eliminados — no un endpoint nuevo, para que filtros, orden y paginación no se
  dupliquen. Por default sigue devolviendo solo los vivos: ninguna pantalla actual cambia
  de comportamiento sin pedirlo.
- Cada fila eliminada devuelve `eliminadoEl` y el **nombre** del usuario que borró (join
  a `usuarios` en la misma query — nunca una consulta por fila).

### Conducta

**a) Restaurar deja inactivo SOLO a `items`.**

> Corregido el 2026-07-31 al medir para el plan. La versión anterior decía "donde exista
> la columna `activo`", y era de más.

`items.remove()` es el **único** de los 16 que hace `activo = false` junto con
`eliminado_el = NOW()` (`items.service.ts:1774`). Ahí el valor previo de `activo` se
perdió de verdad, y restaurar como activo haría que algo vuelva a venderse por sorpresa:
se restaura inactivo, y reactivarlo es un segundo gesto deliberado. Misma cautela que
Toast, donde restaurar un ítem no lo devuelve al menú.

En los otros 15, `remove()` **no toca `activo`**. El valor previo sobrevive intacto, así
que restaurar no lo modifica — forzarlo a `false` destruiría información que el borrado
no había destruido.

**b) Restaurar deshace exactamente lo que ese borrado se llevó, ni más ni menos.**

Dos de los 16 borran colaterales, y son los dos que necesitan esta regla:

- **`items.remove()`** soft-deletea las filas de `receta_extras_permitidos` en las dos
  direcciones (como ingrediente y como receta).
- **`salones.eliminarSalon()`** soft-deletea todas las `mesas` del salón
  antes de borrar el salón.

Son colaterales del borrado, no decisión del usuario: restaurar el padre las revive.

**Acotado por `eliminado_el` idéntico al del padre.** Al correr en la misma transacción,
`NOW()` es el mismo valor para todas las filas que ese borrado tocó. Lo que se hubiera
borrado antes por otro motivo tiene otro timestamp y **no** revive — una mesa que ya
estaba borrada antes de borrar el salón sigue borrada después de restaurarlo.

**c) Huérfano tolerado, sin cascada.**

Restaurar un ítem cuya categoría sigue borrada lo deja sin categoría visible. No se
restaura la categoría ni se bloquea la operación. Es lo que hacen Square, Toast y Clover
sin excepción.

**d) Colisión de nombre → 400, no sobrescritura silenciosa.**

> Corregido el 2026-08-01 tras la revisión final: la versión original de este
> punto afirmaba que `descuentos`/`recargos` (y por extensión `turnos`, sumado
> después) "no tienen unicidad por nombre". Es falso — la garantizan en código,
> no en la base. La unicidad de nombre no es una propiedad de familia de
> borrado (SQL cruda vs. `softDelete()`): hay que medirla recurso por recurso,
> por índice **o** por código.

Cinco entidades del alcance tienen nombre único por tenant vía **índice único
parcial** (`WHERE eliminado_el IS NULL`): `grupos_modificadores`, `causas_merma`,
`motivo_diferencia_caja`, `motivo_diferencia_inventario`, `cajones`. Si alguien
ocupó el nombre mientras tanto, `restaurar()` capta el `23505` de Postgres y
devuelve 400 explicando que hay que renombrar el vivo o el restaurado.

Tres entidades garantizan la unicidad **solo en código**, sin índice en la base:
`descuentos` y `recargos` (`validarNombreUnico`, reusado por `create()`/`update()`,
filtra `eliminado_el IS NULL`) y `turnos` (`assertNombreUnico`, un `findOne` que
TypeORM ya filtra solo por el `@DeleteDateColumn`). `restaurar()` tiene que llamar
a esa misma función antes de revivir la fila — sin eso, el hueco es idéntico al de
las cinco de arriba, solo que sin Postgres de por medio para avisar con un
`23505`: se puede crear "Black Friday", borrarlo, crear otro "Black Friday", y
restaurar el viejo deja dos vivos con el mismo nombre.

Las siete restantes (`items`, `categorias`, `impuestos`, `terceros` del catálogo
del negocio; `salones`, `mesas`, `impresoras` de config operativa) **no tienen
unicidad por nombre de ningún tipo**: ahí la colisión no puede ocurrir. Medido,
no supuesto.

### Frontend

Cada listado del alcance gana un control para ver los eliminados y, en esas filas, un
botón Restaurar con confirmación. Las filas eliminadas se distinguen visualmente y
muestran quién y cuándo.

Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. La lógica de presentación va a
un composable de `app/composables/`, no local a un `.vue` — si los 17 listados repiten el
patrón, se extrae a la tercera repetición, no antes.

## Fuera de alcance

- **Revertir ediciones / versionado.** Descartado con la investigación en la mesa.
- **Bitácora de "quién cambió qué".** `eliminado_por` cubre el borrado; auditar ediciones
  es otra feature.
- **Ventana de retención y purga automática.** Ningún producto del mercado la documenta y
  nuestro soft delete ya es permanente. Agregarla sería inventar una regla que nadie pidió.
- **Seguridad y acceso** (roles, usuarios de un rol, miembros del tenant, config y
  api-keys de pasarela): restaurar devuelve permisos, y las api-keys son secretos
  revocados a propósito.
- **Suscripciones e inscripciones de pasarela**: restaurar puede reactivar un cobro
  recurrente que alguien canceló a propósito.
- **`medios-pago-online/:id`**: pese al nombre, no es config del tenant — borra el
  **medio de pago tokenizado de un usuario** (su tarjeta guardada). Restaurar una tarjeta
  que alguien eliminó a propósito es un problema de privacidad, no una comodidad. Entra
  en el mismo grupo excluido que las inscripciones de pasarela.
- **`cuentas/:id/lineas/:lineaId`**: es transaccional (una línea de una cuenta abierta),
  no catálogo.
- **`tenants/:id`** (borrar el tenant entero) y **`tenants/members/:userId`**.
- **`tenants/razones-sociales/:id`**: queda fuera de esta versión **a propósito**. Es
  config admin-only y restaurarla no emite nada, pero es la identidad del emisor fiscal y
  CLAUDE.md manda detenerse antes de tocar lo fiscal. Es una línea sumarla si el owner la
  quiere; no entra por default.
- **Kardex** (`movimientos_inventario`): ADR-007 lo declara inmutable — se compensa con un
  movimiento contrario, no se revierte.
- **Uniformar las tres puentes de reglas de precio.** No hace falta para esto: `remove()`
  no las toca, así que ya se restauran solas.

## Testing

- **Unit por service**: restaurar devuelve la entidad y deja `activo = false`. Restaurar
  algo que no está en la papelera —porque no existe, o porque existe y está vivo— es
  **404 con el mismo mensaje**: la búsqueda es `WHERE id = $1 AND tenant_id = $2 AND
  eliminado_el IS NOT NULL`, una sola regla, sin rama que distinga los dos casos.
- **Colisión**: con un vivo ocupando el nombre, restaurar da 400 y **no** modifica ninguna
  de las dos filas.
- **Colateral acotado** (el caso más fácil de romper): borrar el ítem A revive sus
  `receta_extras_permitidos`; una fila de esa tabla borrada **antes** por otro motivo
  sigue borrada después de restaurar A.
- **E2E**: borrar → listar incluyendo eliminados → restaurar → aparece en el listado
  normal, inactivo, con las reglas de precio intactas.
- Cada fix lleva **mutante verificado revirtiendo al código anterior**, no un `throw`.

## Riesgos

- **16 entidades es repetición.** El riesgo real no es el volumen sino el drift: que la
  entidad 14 implemente el restaurar distinto de la 1. Mitigación: implementar dos
  completas primero —una del catálogo sin unicidad y una de config con nombre único—, y
  recién con ese par estable replicar.
- **Olvidar `eliminado_por` en un `remove()`.** La columna queda `NULL` y la papelera
  muestra "quién" vacío. No rompe nada, pero degrada en silencio.
- **El guard de restaurar debe ser el del `DELETE`, no el del `GET`.** Copiar el guard
  equivocado abre una escritura con permiso de lectura.
