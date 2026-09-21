# Frontend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-07-15

Patrón de referencia para pantallas del frontend (Nuxt 4 + Vue 3 + `@nuxt/ui` v4),
extraído del código real (`app/pages/configuracion/razones-sociales.vue`). **Léelo
antes de planificar una feature**: cada sección condensa el patrón y apunta al
archivo real para copiar/adaptar.

> Convenciones transversales:
> - **Iconos: Lucide** — formato `i-lucide-{name}` (ver `frontend/docs/DESIGN-SYSTEM.md` § Iconos).
> - **Llamadas API: `useApiFetch`** (`composables/useApiFetch.ts`), NO `$fetch`
>   directo ni axios. Inyecta el Bearer token y reintenta tras refresh en 401.
> - **Sin store** para pantallas CRUD de config: estado local con `ref`/`reactive`.
> - **Update optimista con revert** para toggles/estrellas (no re-fetch).
> - **Tras POST/PATCH/DELETE: no re-fetch.** El backend devuelve la entidad
>   mutada; el front la inserta/reemplaza/elimina en el `ref` local (y en
>   catálogos derivados, p. ej. selector de ingredientes de receta). Ver §5.
> - Mensajes de error del backend vía `e.data.message`, mostrados en un `useToast`.
> - URL base: `useRuntimeConfig().public.apiUrl`.
> - **Campos decimales/monetarios → string de punta a punta** (ver §7): `UInput`
>   `inputmode="decimal"`, nunca `type="number"`.
> - **Toda página suelta con `layout: 'dashboard'` lleva header** (ver §2).

---

## 1. Navegación

Agregar el item al computed `navItems` de `app/pages/configuracion.vue` (dentro del
bloque `permissionsStore.esAdmin` si es solo admin):

```typescript
{ label: 'Monedas', icon: 'i-lucide-dollar-sign', to: '/configuracion/monedas' }
```

Pantallas CRUD simples pueden usar `app/components/crud/` (`CrudPageHeader`,
`CrudTable`, `CrudListItem`, `CrudModal`) — ver `DESIGN-SYSTEM.md` § Componentes CRUD
y `configuracion/categorias.vue`.

**Un reporte nuevo** no va al menú a mano: se agrega al catálogo de
`composables/useReportes.ts` (título, ruta y el permiso que lo gatea). Esa lista
alimenta a la vez la entrada "Reportes" de `layouts/dashboard.vue` —visible si el
usuario puede ver al menos uno— y las tarjetas del índice `/reportes`, así los dos
no pueden desincronizarse. La pantalla del reporte igual declara su propio
`middleware: ['auth', 'permiso']` (§ 1.2).

### 1.1 Gatear los controles de escritura por permiso

Una pantalla se abre casi siempre con el permiso de **lectura** del módulo, pero
sus botones de escritura pegan a endpoints con `@RequiresPermiso(...)` más
estrictos. Si el control se renderiza igual, el usuario completa el formulario
entero para recibir un 403: un callejón sin salida.

**Regla:** todo control que dispare una escritura se gatea con el **mismo**
permiso que exige su endpoint. El guard del backend es el que manda —
esconder el botón es UX, nunca seguridad (invariante 6).

Los permisos salen de **`usePermisosCrud(modulo)`**, nunca escritos a mano:

```ts
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')
// Un permiso suelto conserva su nombre de dominio con un alias:
const { puedeActualizar: puedeAplicar } = usePermisosCrud('Items')
```

Devuelve `computed`s, así que se puede llamar en el setup aunque los permisos
lleguen después por fetch. El composable existe por el `esAdmin ||`, no por el
`can`: la regla estaba copiada en 18 pantallas y componentes, y olvidar el bypass deja
al admin de ese tenant con una pantalla de solo lectura — el usuario con más
motivos para no reportarlo como bug de permisos, porque asume que es así.

**Primero preguntar qué exige el endpoint, no de qué carpeta es la pantalla.**
En `configuracion/` conviven las dos clases: 15 pantallas son admin-only
(`TenantAdminGuard`) y `items` va con `@RequiresPermiso('Items', …)`. Gatear
`items` con `esAdmin` porque sus vecinas lo son le escondería los botones a
quien **sí** puede escribir — el bug inverso al que este gate viene a evitar.

El corte, a jul-2026 (la fuente de verdad es el controller, no esta lista):

| Clase | Pantallas | Gate |
|---|---|---|
| Catálogos y config del tenant | 15 de `configuracion/` (categorías, impuestos, monedas, roles, usuarios…) | `TenantAdminGuard` → middleware `admin` |
| Features operativas | `items`, `terceros`, POS, `desfases`, inventario, recuentos, mermas… y, dentro de `configuracion/`, `garzones`, `impresoras`, `salones` y `turnos` | `@RequiresPermiso` → gate por control |

**Y no colapsar permisos distintos en un `puedeEscribir` único.** Si el backend
separa `Crear`, `Actualizar` y `Eliminar`, la pantalla los separa: hay roles con
uno solo, y un gate único le esconde a un editor el botón de editar.

**El módulo del permiso no se deduce del nombre de la pantalla.** `garzones`,
`salones` y `turnos` no tienen módulo propio: sus rutas piden `Salones:*`. Y que
el módulo tenga un permiso más —`Salones:Operar`— no significa que aplique acá:
`Operar` es de la operación (cuentas, comandas, identificar garzón), no de la
pantalla de configuración. Se lee el `@RequiresPermiso` de **esa** ruta.

**Y el link del menú se gatea con `Leer`, no con la escritura.** Si la entrada de
navegación pide `Crear`, el gate por control queda muerto para quien solo tiene
`Actualizar` o `Eliminar`: nunca llega a la pantalla. El menú pregunta "¿puede
abrir esto?", no "¿puede escribir acá?".

**No todo control de escritura es un botón.** En `salones` la escritura más fácil
de pasar por alto es el plano: arrastrar una mesa guarda (`PATCH :id/layout`) y el
doble-click abre el editor (`PATCH /mesas/:id`). Se gatea la prop que habilita la
interacción (`:editable="puedeActualizar"`), no un botón. Antes de dar una pantalla
por gateada, listar sus escrituras desde el controller y tacharlas una por una.

### 1.2 Pantalla entera detrás de un permiso: middleware de ruta, no `v-if` por botón

Cuando **toda** la pantalla exige lo mismo —no controles sueltos— el gate va en
la ruta. Hay dos middlewares, uno por cada corte:

```typescript
// Toda la escritura exige `TenantAdminGuard` → ¿es admin del tenant?
definePageMeta({ middleware: 'admin' })

// La pantalla entera exige un permiso de módulo → ¿tiene este permiso?
definePageMeta({ middleware: ['auth', 'permiso'], permiso: 'Cajas:Leer' })
// `permisoLabel` cuando el aviso por defecto —"No tenés acceso al módulo <módulo>"—
// sería confuso o directamente falso. Dos casos, los dos reales:
//   a) el módulo se llama distinto en pantalla
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'MiCaja:Leer',
  permisoLabel: 'Mi caja',
})
//   b) lo que falta es la ACCIÓN, no el módulo: quien tiene `Salones:Leer` y
//      administra salones NO puede operar, y decirle "no tenés acceso al
//      módulo Salones" es falso. El label es lo único que ese mensaje deja
//      ajustar — no puede nombrar la acción.
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Salones:Operar',
  permisoLabel: 'Salones (operación)',
})
```

`admin` redirige a `/configuracion`; `permiso` a `/ventas`, avisando por toast
cuál es el módulo que falta. Tres razones para preferirlos al `v-if`:

- **Cubre la URL escrita a mano**, que el `v-if` no cubre: esconderla del menú
  no impide navegar, la lectura de esos endpoints es abierta y la tabla carga
  igual.
- Un mecanismo en vez de ~60 `v-if` sueltos que hay que mantener sincronizados.
- Corre **antes** de montar. El guard escrito en un `onMounted` —el patrón que
  `permiso` vino a reemplazar en las seis pantallas de caja— deja ver la pantalla
  y recién después rebota.

⚠️ El middleware **espera** `permissionsStore.ensureCargado()` antes de decidir.
La navegación corre **antes** del `onMounted` que puebla el store, así que sin
esa espera un admin entrando por URL directa o F5 se lee como no-admin y queda
expulsado de su propia pantalla. Es un modo de falla que nadie reporta como bug
de permisos: se ve como "la pantalla me tira al índice a veces".

ℹ️ Esa espera **rompía la hidratación del menú lateral** mientras hubo SSR: el
servidor renderizaba el sidebar con el store vacío y el cliente llegaba a hidratar
con él ya poblado. Dejó de poder pasar con `ssr: false`
([ADR-017](../adr/017-spa-sin-ssr.md)) — vale conocerlo porque es la razón por la
que la app es SPA, y porque volvería si alguien reactivara el SSR.

```typescript
const { puedeCrear: puedeContar } = usePermisosCrud('Inventario')
```

Cuando la escritura ya está condicionada por estado, sumar el permiso a esa
misma condición en vez de agregar un `v-if` paralelo — así queda un solo lugar
que decide (`recuentos/[id].vue`: `readOnly = !esBorrador || !puedeContar`).

**Pero un `readOnly` así vale para UN permiso, no para la pantalla entera.** Ojo
con los permisos **asimétricos**: en recuentos, contar es `Inventario/Crear` y
aplicar es `Inventario/Actualizar` a propósito, para separar a quien cuenta de
quien aprueba. `readOnly` gatea solo los campos del conteo; los botones de la
cabecera llevan cada uno el suyo.

Trampa concreta, ya cometida acá: si un botón cuelga de `v-if="!readOnly"`,
hereda el permiso de `readOnly` aunque tenga su propio `v-if` adentro. Así el
rol aprobador (`Leer` + `Actualizar`, sin `Crear`) se quedó sin el botón
"Aplicar" — anidado bajo el `readOnly` de contar. Un control con permiso propio
no va anidado bajo el gate de otro permiso.

---

## 2. Página — estructura `<script setup>`

`app/pages/configuracion/<feature>.vue`. Esqueleto:

```typescript
<script setup lang="ts">
interface Item { id: string; nombre: string; habilitado: boolean; preferida: boolean }

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const items = ref<Item[]>([])
const loading = ref(false)
const toggling = reactive(new Set<string>())   // tracking de filas en vuelo

async function cargar() {
  loading.value = true
  try {
    items.value = await useApiFetch<Item[]>(`${apiUrl}/<recurso>`)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar', color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(cargar)
</script>
```

> Las páginas de `configuracion/` heredan `middleware`/`layout` del padre
> `configuracion.vue` (que ya provee el header vía `AppNavbar`): su `<template>` va
> directo al contenido sin `UDashboardPanel`.
>
> Para una página suelta (no anidada) usar
> `definePageMeta({ middleware: 'auth', layout: 'dashboard' })` **y** envolver el
> `<template>` en `UDashboardPanel` — el layout `dashboard.vue` solo aporta el
> sidebar, cada página es responsable de su header:
>
> ```vue
> <template>
>   <UDashboardPanel>
>     <template #header>
>       <AppNavbar title="Historial de ventas" />
>     </template>
>     <template #body>
>       <div class="max-w-5xl mx-auto py-6"><!-- contenido --></div>
>     </template>
>   </UDashboardPanel>
> </template>
> ```
>
> `AppNavbar` (`app/components/AppNavbar.vue`) ya incluye el collapse del sidebar y
> el `UserMenu` en `#right` — no usar `UDashboardNavbar` directo ni duplicar el
> `UserMenu`. Referencias: `pages/index.vue`, `pages/ventas/index.vue`, `pages/caja/index.vue`.

---

## 3. Update optimista con revert (toggle y estrella "solo uno")

Patrón único para toggles (`habilitado`) y distintivos únicos (`preferida`/default):
guardar el valor previo, mutar la UI de inmediato, llamar la API, y en `catch`
revertir. `toggling` (Set) evita doble click.

```typescript
async function toggleHabilitado(it: Item) {
  if (toggling.has(it.id)) return
  toggling.add(it.id)
  const prev = it.habilitado
  it.habilitado = !prev                          // optimista
  try {
    await useApiFetch(`${apiUrl}/<recurso>/${it.id}`, {
      method: 'PATCH',
      body: { habilitado: it.habilitado },
    })
    toast.add({ title: it.habilitado ? 'Habilitado' : 'Deshabilitado', color: 'success' })
  } catch (e: unknown) {
    it.habilitado = prev                         // revert
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
  } finally {
    toggling.delete(it.id)
  }
}
```

Para el distintivo único (estrella), la regla "solo uno" se refleja optimistamente:
limpiar el anterior (`prev = items.find(x => x.preferida)`), marcar el nuevo, y en
`catch` **revertir ambos**. Precondiciones (p. ej. debe estar habilitado) se validan
en cliente con toast `warning` antes de mutar. Ver `togglePreferida` en
`razones-sociales.vue` o `configuracion/monedas.vue`.

---

## 5. Crear / editar / eliminar

- **Crear/editar**: un `UModal`/`AppDrawer` con `v-model:open`,
  `form = ref(emptyForm())`, `editingId = ref<string | null>(null)`.
  `guardar()` hace POST o PATCH según `editingId`, **captura la entidad
  devuelta** y la mergea en el `ref` de la lista (y en cualquier catálogo
  derivado en memoria). **No** llamar otra vez a `cargar()` / `fetch()`.
- **Eliminar**: segundo modal de confirmación; tras DELETE exitoso, sacar el
  id del array local (y de catálogos derivados). Sin re-fetch.
- **Contrato backend**: POST/PATCH arman la respuesta con `RETURNING` + datos
  de la mutación (sin `findOne` post-write). Create → fila usable en lista;
  update → patch mergeable. Así el front actualiza `costoActual`/stock sin GET.

```typescript
const saved = editingId.value
  ? await useApiFetch<Item>(`${apiUrl}/items/${editingId.value}`, {
      method: 'PATCH',
      body: payload,
    })
  : await useApiFetch<Item>(`${apiUrl}/items`, {
      method: 'POST',
      body: payload,
    })

upsertItemEnLista(saved, !editingId.value) // respeta filtros de la página
syncCatalogoDerivado(saved)                 // p. ej. productosIngrediente
```

Referencia: `app/pages/configuracion/items.vue` (`upsertItemEnLista`,
`syncProductoIngrediente`). Para toggles sigue valiendo §3 (optimista +
revert). Archivo CRUD clásico con toggle: `razones-sociales.vue`.

---

## 6. Template (`@nuxt/ui` v4)

| Necesidad | Componente |
|---|---|
| Contenedor | `UCard` |
| Lista | `<ul class="divide-y …">` con `<li v-for>` |
| Toggle habilitar | `USwitch` con `:model-value` + `@update:model-value` y `:disabled` |
| Estrella default | `<button>` + `UIcon` (`i-lucide-star` + `fill-current` si activo) |
| Distintivo | `UBadge` |
| Acciones | `UButton` con `icon`, `variant="ghost"`, `color` |
| Modal | `UModal` con `v-model:open` y slots `#body` / `#footer` |
| Campo de form | `UFormField` + `UInput` / `USwitch` |

Estados de carga/vacío: bloques `v-if="loading"` / `v-else-if="!items.length"` con
texto centrado gris antes de la lista.

**Dentro de una celda de `UTable`, un `<span>` sin clase de color se renderiza
atenuado.** El `td` del tema trae `text-muted` y `color` es una propiedad
heredada, así que "no le puse color" significa "queda gris", no "queda en el
color por defecto". Cuando un texto dentro de una celda tiene que **destacar**
—un rótulo que desambigua una cifra, por ejemplo— hay que declararle
`text-highlighted` explícito. La clase directa gana sobre la herencia sin
depender de especificidad ni del orden de las utilidades.
Costó un ciclo de revisión en ago-2026: el código decía "sin color atenuado" y
el render decía lo contrario. **Verificar el token efectivo, no la ausencia de
clase.**

---

## 7. Campos decimales / monetarios → string de punta a punta

**Regla (estilo único):** todo campo que el backend valide con `@IsNumberString`
(precios, montos, porcentajes, stock, cantidades — ver [backend.md §3](./backend.md))
se maneja como **string en todo el flujo**: el `ref` del form es string, el input lo
mantiene string, y viaja string en el body **sin conversiones**.

- **Campos monetarios con moneda:** usar `MoneyInput` con `v-model` string (ver §8).
- **Fechas / fecha-hora / hora:** usar `AppDateInput` (`YYYY-MM-DD`),
  `AppDateTimeInput` (`YYYY-MM-DDTHH:mm`, `hour-cycle` 24) o `AppTimeInput`
  (`HH:mm`, p. ej. turnos). Wrappers de `UInputDate` / `UInputTime` (+ `UCalendar`
  en popover para fechas) — **prohibido** `type="date"` / `type="datetime-local"` /
  texto libre para horas (picker nativo o formato inconsistente). Locale: `UApp`
  con `es-CL` en `app.vue`.
- **Otros decimales (stock, porcentajes, tasas):** `UInput` de texto con
  `inputmode="decimal"` (teclado numérico en móvil). **Prohibido `type="number"`**
  en campos `@IsNumberString`: hace que `v-model` escriba un **`number`** y produce
  `400 "X must be a number string"`.

```vue
<!-- ✅ Precio / monto con moneda → MoneyInput (string limpio al API) -->
<MoneyInput v-model="form.precioBase" :moneda-id="form.monedaId" />
<MoneyInput v-model="form.saldoInicial" oficial />

<!-- ✅ Fechas / horas → AppDate* / AppTimeInput (Nuxt UI, no nativo) -->
<AppDateInput v-model="filtroDesde" />
<AppDateTimeInput v-model="fechaDesde" qa="liq-fecha-desde" />
<AppTimeInput v-model="form.horaInicio" qa="turno-hora-inicio" />

<!-- QA: ./scripts/qa/date-time-inputs-e2e.sh --all -->

<!-- ✅ Stock, porcentaje, tasa de cambio → UInput decimal sin maska de moneda -->
<UInput v-model="form.stock" inputmode="decimal" placeholder="0" />

<!-- ❌ type="number" → v-model pasa a number → 400 "must be a number string" -->
<UInput v-model="form.precioBase" type="number" />

<!-- ❌ pickers nativos / hora como texto libre -->
<UInput v-model="fecha" type="date" />
<UInput v-model="desde" type="datetime-local" />
<UInput v-model="horaInicio" placeholder="08:00" />
```

El payload va directo, sin `String(...)` (el valor ya es string); defaults tipo
`form.value.stock || '0'` solo para no mandar `''`.

> **Excepción — enteros reales** (`@IsInt`, p. ej. `duracionEstimada`): el backend
> espera `number`, ahí **sí** se usa `type="number"`. La regla `inputmode` aplica
> solo a los `@IsNumberString`.

### 7.1 Rango de fechas → `AppRangoFechas`

Un filtro `desde`/`hasta` nuevo usa `AppRangoFechas`, no dos `AppDateInput` sueltos:

```vue
<AppRangoFechas v-model:desde="filtroDesde" v-model:hasta="filtroHasta" qa="varianza-rango" />
```

Contrato: los dos `v-model` son `string | null` en `YYYY-MM-DD` (limpiar una punta
emite `null`, nunca `''`); `qa` se sufija `-desde` / `-hasta` / `-aviso`. Trae
`DiaNegocioNota` adentro —el rango se lee en días del negocio— y valida el cruce:
con `desde` posterior a `hasta` avisa y **no emite**, así ninguna pantalla manda un
rango invertido que el backend contestaría con 400 o con una tabla vacía.

⚠️ **No arma fechas.** El default de la pantalla ("este mes") se arma en la página
con `hoyLocal()`, nunca con `toISOString()` (lo rechaza
`invariants/fecha-local.invariant.spec.ts`).

📌 **Lo compartido vive en la raíz de `app/components/`**, no en la carpeta de un
módulo: una pantalla vieja tiene que poder usarlo sin mudarse. Hoy lo usa solo
`reportes/varianza.vue`; las pantallas con dos `AppDateInput` sueltos **no se
migraron** (decisión del owner: nada se muda de arrastre).

---

## 8. Monedas — store, formato (Intl) e inputs (maska)

Detalle funcional completo (arquitectura, tablas de uso por pantalla, alta de
monedas nuevas): [features/configuracion-monedas.md](../features/configuracion-monedas.md).

| Necesidad | Solución |
|-----------|----------|
| Mostrar precio en lista / solo lectura | `formatMonto(value, monedaId?)` — sin `monedaId` usa la **oficial** del tenant |
| Input con formato en tiempo real | `<MoneyInput v-model="..." :moneda-id="..." />` o prop `oficial` (maska) |
| Lookup O(1) por moneda | `monedasStore.getById(uuid)` (Pinia, un fetch por sesión/tenant) |
| Valor al API | **string** limpio (`"1500000"`, `"1500.5"`) |

Reglas:
- La config de presentación (`locale`, `simbolo`, `decimales`, separadores) viene de
  la tabla `moneda` vía `GET /monedas` → `useMonedasStore` (`ensureLoaded()` en
  `dashboard.vue`; `reset()` en logout/switch-tenant). **No** duplicar `GET /monedas`
  en páginas. **No** concatenar `monedaSimbolo + monto`.
- Monedas ISO 4217 → `Intl.NumberFormat`; códigos custom (UF) → formato manual.
  Vacío / `null` → `'—'`.
- `MoneyInput` NO se usa para stock, cantidades, porcentajes ni `valorDelDia`
  (ahí va `UInput inputmode="decimal"`, ver §7).
- **Sin moneda resoluble, `MoneyInput` se renderiza DESHABILITADO** (`!cfg` →
  `:disabled`). O sea que en una pantalla donde la moneda del monto no se puede
  determinar —porque depende de un ítem que todavía no se eligió— ponerlo no degrada a
  "campo sin ayuda visual": mata el campo. Ahí va `UInput inputmode="decimal"` pelado,
  con el porqué escrito al lado. Usar la moneda oficial del tenant "para llenar el
  hueco" es peor que no dar ayuda: da los separadores equivocados.
- ⛔ **El 400 del backend NO es red contra el `.`→×10, en ningún campo.** El bullet de
  abajo describe ese error y lo presentaba como *visible* porque el backend rechaza la
  escala. **Medido el 2026-08-26 y es falso:** el resultado del error es un **entero**
  (teclear `800.5` en CLP emite `8005`), y un entero es válido en cualquier escala —los
  0 decimales del peso incluidos—, así que ningún validador de escala lo ve. **Que la
  moneda tenga decimales tampoco lo evita**: el punto sigue siendo su agrupador, y en UF
  (4 decimales, miles `.`) teclear `1000.5` da `10005` igual — medido, y fijado en el
  describe "limitación conocida" de `MoneyInput.spec.ts`. Antes de estrenar un
  `MoneyInput` en un campo nuevo, pesar eso; y con más razón si el campo aplica el mismo
  número a **N filas** de una vez (caso vivo: el "aplicar en lote" de
  `grupos-modificadores.vue`, que por esto se quedó con `UInput` pelado). Lo que se midió,
  las salidas que se probaron y por qué el owner lo aceptó: `docs/agent/resueltos.md`.
- `MoneyInput` bloquea tipear más decimales de los que la moneda resuelta admite
  (`number.fraction` de maska) — la contraparte en pantalla del rechazo 400 del backend
  (`EscalaMonedaPipe`).
  📌 **Contrato de teclas, confirmado por el owner el 2026-09-01** (y ya implementado): el
  separador de **miles no se tipea** —maska agrupa sola— y el único que se puede tipear es
  el **decimal del país**, que abre la parte decimal si la moneda la admite. Medido tecla
  por tecla en CLP: `1`,`0`,`0`,`0` → `1.000`; después `,` → `1.000,` y el `5` da `1.000,5`;
  después `.` → inerte.
  ⚠️ **Limitación conocida, aceptada por el owner el mismo día, y solo en el TECLEO:** en una moneda con miles `.`, maska
  lee ese punto como agrupador, así que teclear `1000.5` en CLP da `10005` **y se
  guarda** (ver el bullet de arriba: ningún 400 lo ataja). NO intentar taparlo desde el
  input: ya se probó con un `preProcess` con memoria de la última tecla y salió peor
  (rompía el caso chileno normal `1.500` → `1`, o sea montos válidos y MENORES guardados
  en silencio). **La información no está ahí**: `1`,`.`,`5`,`0`,`0` (mil quinientos) y
  `1`,`0`,`0`,`.`,`5` (ochocientos y medio) son el mismo gesto, y lo único que los
  separa son los dígitos que siguen al punto, que maska ya colapsó cuando llegan. El
  contrato está fijado en `MoneyInput.spec.ts`, describe "limitación conocida".
  ✅ **El PEGADO está atajado desde el 2026-09-01, con límites que conviene saber.**
  Ahí la cadena llega entera, así que la agrupación se puede juzgar: `MoneyInput`
  escucha el evento `paste` y decide con `parseMontoPegado` (puro, en
  `utils/currency-format.ts`), que reescribe cuando el valor cabe en la escala del campo
  y **rechaza sin guardar nada** cuando no cabe. No redondea ni recorta: las dos guardan
  un número que nadie escribió. Lo que decide es el **valor**, no cuántos caracteres
  trae la cola —`1.500,00` en pesos son mil quinientos y entra—.
  ⚠️ **Cubre el pegado que REEMPLAZA el campo entero, y solo cadenas de dígitos con los
  dos separadores de la moneda** (más el espacio que agrupa y el signo, que se
  normalizan). Con el caret en medio de lo ya escrito, el texto que queda no es el del
  portapapeles y el handler no opina; y un `(1.000,5)` contable o dos celdas de una
  planilla siguen de largo hasta la máscara, con lo que eso da. Ahí sigue pasando lo del
  tecleo. Y queda una ambigüedad que **no se puede resolver leyendo**:
  `12.345` en un campo de 4 decimales es `12345` en es-CL y `12,345` en en-US, y el
  componente elige la chilena — no es que no adivine, es que adivina siempre igual.
  ✅ **El punto fijo con monedas de más de 0 decimales está arreglado (2026-08-21).**
  Hasta entonces `MoneyInput` quedaba **muerto tras la primera tecla** con `decimals > 0`
  (o con el prop `decimales`): el `watch` de `modelValue` reformateaba con
  `toFixed(decimales)` —rellenando la escala completa— también cuando el valor entrante
  era el **eco de su propio emit**, y la tecla siguiente caía al final, donde
  `number.fraction` la truncaba de vuelta. Con `decimals: 0` no pasaba (`toFixed(0)` es
  idempotente), y como la oficial del seed es CLP, el bug vivió sin verse.
  Lo cierra un guard de eco en ese `watch`: lo que vuelve del padre después de nuestro
  propio `emit` **no se reformatea**; un cambio que viene de afuera (abrir un formulario,
  un reset) sí. Verificado tecla por tecla en el navegador: USD `12.50`, UF `5,0500`
  —persistido `5.0500` en la base—, y CLP `1.500` sigue siendo mil quinientos.
  ⚠️ **El prop `decimales` ya no existe: se sacó el 2026-09-08** con su último usuario
  (`configuracion/items.vue`). Forzaba la escala del campo a 4 —la de `@EsCosto()`,
  independiente de la moneda del ítem— y era la forma de fabricar el único caso ambiguo
  del sistema. La escala se pide ahora con una moneda que la tenga; ver el bullet de
  abajo, que es el que decide.

  **Lo que el arreglo revive solo:** los siete `MoneyInput` atados a `:moneda-id` de
  `items.vue` e `inventario/index.vue` — el precio del catálogo de un ítem en USD o UF ya
  se puede editar, sin tocar esas páginas.
  **Lo que NO revivía solo** eran `mermas.vue` (`costoUnitario`) y
  `grupos-modificadores.vue` (`precioExtra`, `lotePrecio`), porque `MoneyInput` necesita
  una moneda y ninguna de las dos la tenía a mano. **Estado al 2026-08-26:**
  - `mermas.vue` **migrado el 2026-08-26** con `MoneyInput` atado a
    `productoSeleccionado?.monedaId` y `:decimales="4"` — y **ese campo entero se sacó
    del formulario el 2026-08-28**: el costo se maneja en el producto, no se tipea al
    mermar (owner,
    [spec](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md)). `mermas.vue`
    hoy no tiene input de costo; el filo del `:decimales="4"` que este bullet documentaba
    quedó sin efecto porque el campo ya no existe.
  - `grupos-modificadores.vue` **se queda sin `MoneyInput`, y es deliberado**, con dos
    razones distintas según el campo. En el drawer del grupo no hay ítem, así que no hay
    moneda que resolver (la opción hereda la del ítem al que se aplica — owner
    2026-08-25). En el "aplicar en lote" sí suele haberla, pero el campo aplica el mismo
    número a N recetas y el `.`→×10 no lo ataja el backend en un campo de escala fija
    (ver el bullet de §8): un input pelado manda `800.5` tal cual. La ayuda visual sí
    está donde el ítem existe: `items.vue` (precio extra por receta y extras permitidos).
  - Lo que se arregló ahí fue otra cosa: el precio extra **se mostraba** con la moneda
    oficial del tenant. Ahora `GET /grupos-modificadores/:id/items` devuelve el
    `monedaId` de cada receta y la pantalla formatea con él.

- ⭐ **Un input de dinero sigue los decimales de la moneda del ítem: la precisión de una
  tasa la da el selector de unidad** (owner, 2026-08-28 —
  [spec](../superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md); extendido al
  precio de venta el 2026-09-08). Se tipea *"5.050 por kilo"* en pesos enteros, no
  *"5,0500 por gramo"*. El motivo es el bullet de arriba: un campo de 4 decimales sobre un
  ítem en pesos era el caso donde `1.500` significa a la vez `1500` y `1,5`, y maska elige
  una lectura en silencio. Con 0 o 2 decimales la ambigüedad no existe (medido: 0 casos
  sobre 3332 cadenas). La escala del backend **no** cambia: `ESCALA_COSTO` sigue en 4
  porque CPP genera fracciones al promediar; lo que sigue a la moneda es el teclado
  humano, y la conversión de unidad es el puente. Aplicado en el drawer de ajuste de costo
  de `inventario/index.vue` (`unidadCodigo` opcional en `POST /inventario/ajustes-costo`,
  2026-08-28) y en los seis campos de dinero de `configuracion/items.vue` (2026-09-08).
  📌 **Ese campo ya no se puede fabricar desde la pantalla**, porque el prop que forzaba la
  escala se fue con ellos: para tener 4 decimales hace falta un ítem denominado en una
  moneda que los tenga, y la única sembrada es la UF —con **0 ítems** al 2026-09-08 (306
  en CLP, 8 en USD, 5 en ARS, 4 en MXN, 0 en COP)—. No es lo mismo que "no puede pasar":
  es que hoy nadie está parado ahí.

  ⚠️ **Dónde vale, y dónde NO — medido el 2026-08-28.** La regla vale donde el costo se
  tipea **sin cantidad**, que es exactamente el caso del ajuste de costo: ahí el selector
  de unidad es el único que decide la precisión y no arrastra nada más.
  **Donde un mismo selector gobierna la cantidad y el costo a la vez, no vale**: en
  `mermas.vue` elegir "gramo" para mermar 100 g de un producto en kilos lleva el costo a
  `6,5`/g, que en CLP **no es representable**. Medido el 2026-08-28, con el prop `decimales`
  todavía vivo y sacándoselo a ese campo: el POST llevó `"7"` donde el campo decía `6.5`,
  **7,69% de sobrevaloración**, y sin que nadie tocara el campo, porque venía prefilleado.
  El mecanismo era maska, no el `watch` —el `watch` solo escribía `display`
  (`formatMontoDisplay` → `toFixed(0)` → `"7"`), pero ese `display` entraba al `<input>` con
  `v-maska`, disparaba `onMaska` → `syncFromMaska` → `emit`—.
  📌 Precisión del mecanismo (revisión independiente, 2026-08-28): el re-emit **no** dependía
  de que el valor fuera irrepresentable — `v-maska` corre en `mounted` **y en `updated`**, así
  que **todo** valor que entraba de afuera volvía a emitirse. Cuando era representable el emit
  devolvía el mismo número y no se notaba; cuando no lo era, devolvía el redondeado.
  ✅ **Eso se cerró el 2026-09-08**, y es el cambio que hizo posible sacar el prop: el `watch`
  marca lo que pinta desde `props` y `syncFromMaska` no emite ese eco. La regla hoy es
  **`MoneyInput` solo emite lo que la persona escribió**; un valor que no cabe en la escala se
  **muestra** redondeado —no hay otra forma de mostrarlo— pero el modelo del padre queda
  intacto. Fijado en `MoneyInput.spec.ts`, describe *"un valor que entra de afuera se muestra,
  pero no se reescribe"*, y a nivel pantalla en `items.nuxt.spec.ts`.
  📌 Corolario: **esto corrige el §4 de la spec**, que daba por bueno que "el modelo NO se
  trunca solo" a partir del `watch`. Era cierto del `watch` y falso del componente — hasta que
  el componente se alineó con el `watch`.
  📌 Por eso `mermas.vue` **no se tocó acá**: el campo de costo se sacó entero del
  formulario en un frente propio, ya cerrado — el costo se maneja en el producto, no se
  tipea al mermar. Ver
  [spec](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md) y
  [plan](../superpowers/plans/2026-08-28-merma-sin-costo-tipeado.md).
  ✅ **Los 6 campos de `items.vue` salieron el 2026-09-08** —precio base, costo de
  producto y de ingrediente, los dos precios extra y el costo unitario de la compra— y con
  ellos el prop. Lo que se hizo en cada uno, y por qué la pregunta *"¿ese selector gobierna
  solo el costo?"* no aplicaba igual a los seis: `docs/agent/resueltos.md`. Esa pregunta
  sigue siendo la que hay que hacerse si mañana aparece un campo de dinero por unidad.

- ⭐ **Cambiar el selector de unidad LIMPIA el campo de costo; convertir lo tipeado es la
  trampa** (owner, 2026-08-28). `1500` por kilo son `1,5` por gramo, y en CLP eso **no es
  representable**: convertir deja en el formulario un número que la moneda no puede expresar
  y que nadie tecleó. Hasta el 2026-09-08 era peor todavía —`MoneyInput` lo redondeaba a `2`
  y lo emitía, o sea que la opción "amable" persistía un costo 33% más alto sin que nadie
  tocara el campo, el mismo modo de falla del 7,69% de arriba—; hoy no lo reescribe, pero
  sigue sin poder mostrarlo entero. Limpiar cuesta un retipeo y no puede inventar nada.
  Aplicado en el drawer de ajuste de costo de `inventario/index.vue`; fijado en
  `app/pages/inventario/index.nuxt.spec.ts`.
  📌 **Y desde el 2026-09-08 también en `configuracion/items.vue`**, en los dos lugares
  donde un selector de unidad convive con un campo de dinero por esa unidad: el alta del
  ítem (la unidad de medida limpia costo y precio base) y el modal "Ajustar stock" (la
  unidad limpia el costo de la compra). Fijado en `items.nuxt.spec.ts` y en
  `items-stock-ubicacion.nuxt.spec.ts`. La etiqueta de esos campos nombra la unidad
  —"Costo (por kg)"—: desde que la escala la da la moneda, la unidad es lo único que fija
  la magnitud del número.
  📌 **Y desde el 2026-09-11 también al editar** un ítem que todavía no se usó (el backend
  dice en `unidadBloqueada` si ya se usó): en un producto con precio, cambiar la unidad pide
  confirmación y vacía el precio. Es el esquema de la moneda y no el del alta —cuelga del
  gesto (`:model-value` + `@update:model-value`), no de un `watch`—, porque al editar la ficha
  se carga con la unidad del ítem y un `watch` no distingue esa carga de una elección.
  📌 **Cambiar de PRODUCTO limpia igual, y por su cuenta** (owner, 2026-08-29). El número
  tipeado pertenece al producto tanto como a la unidad, y encima el producto puede traer
  **otra moneda**: ahí no queda un número viejo, queda el mismo número re-enmascarado bajo la
  escala nueva —`1.500` en CLP se lee `1,500.00` en USD—. ⚠️ Hasta el 2026-09-08 el modelo
  además volvía del componente como `1500.00`; cerrado el re-emit conserva `1500`, que es el
  mismo número y se muestra igual. Lo que hace falta limpiar no es la escala: es que el número
  fue tipeado para otro producto y otra moneda. ⚠️ **No se puede delegar en el watch de la unidad**: entre dos productos de base
  `kg` la unidad no cambia y Vue no dispara con el mismo valor. Cada watch limpia lo suyo.
  📌 **Y cambiar la MONEDA limpia igual** (owner, 2026-09-09), en `configuracion/items.vue`.
  Mismo motivo —`1500` en pesos no es `1500` en dólares—, con **dos diferencias** que salen de
  que ese selector, a diferencia del de unidad, **no se bloquea al editar**:
  **(a) cuelga del gesto de la persona** (`:model-value` + `@update:model-value`), no de un
  `watch`: `abrirEditar` asigna la moneda con lo que trae la API, y un watch no distingue esa
  carga de una elección —vaciaría el precio recién cargado—. `editingId` no sirve de guard,
  porque editar es justamente cuando el selector se puede tocar.
  **(b) frena pidiendo confirmación**, inline en el drawer.

  ⭐ **La decisión es de DOS ejes, y hay que hacerle las dos preguntas a cada monto**: *¿se
  vacía?* y *¿frena el gesto?* No coinciden: hay montos que no se vacían y frenan igual. El
  barrido que los encuentra no es `grep MoneyInput` —eso da solo los editables— sino
  **`grep formatMonto` dentro del drawer**, y hay que correrlo, no citarlo.

  | Monto | ¿Se vacía? | ¿Frena? | Por qué |
  |---|---|---|---|
  | precio base, costo del alta | sí | sí | columnas de `items`: plata de este ítem |
  | precio de cada extra de receta | sí | sí | `receta_extras_permitidos`, FK a esta receta |
  | costo vigente (producto/ingrediente, al editar) | **no** | sí | no es un campo: sale de los movimientos de inventario |
  | "Costo actual" calculado (receta/combo) | **no** | sí | no es un campo: lo calcula la pantalla desde los ítems que componen a este |
  | precio de opción de modificador | **no** | sí | la API manda el **efectivo** (`COALESCE(override, default)`) sin el default al lado, así que no se puede distinguir el de este ítem del compartido del catálogo — y ese es "del extra como tal" (regla del owner) |
  | monto fijo de un descuento/recargo asociado | **no** | **no** | **no está denominado en la moneda del ítem**: el motor lo aplica DESPUÉS de convertir el precio de la línea (`calculo-precios.service.ts:869`, o `:405` si es receta/combo personalizado). Hoy es plata en la oficial; por decisión del owner (2026-09-09) pasará a tener moneda propia en la regla — bajo los dos diseños la fila dice lo mismo. Además el drawer no lo muestra |

  ⚠️ **La última fila decía otra cosa, y era falsa**: que el monto fijo "no tiene moneda propia"
  y que por eso un `-1000` le descontaba mil **dólares** a un ítem en dólares. La corrección es
  del 2026-09-09 y el detalle vive en [`../agent/resueltos.md`](../agent/resueltos.md).
  📌 **Lo que la hizo falsa no fue el dato sino de dónde se leyó**: se miró el **modelo** —dos
  tablas sin columna `moneda_id`— sin abrir el **orden** en que el motor hace las cuentas. En
  plata, el modelo no alcanza: la misma columna significa una cosa u otra según en qué punto del
  cálculo se la lee. (Qué valida cada marca de escala del backend —`@EsMontoCobrado` contra
  `@EsCosto`— está en [`backend.md`](backend.md) § 3, y **no** es un eje de monedas: es plata
  cobrada contra tasa que se multiplica.)

  ⭐ **Nada cambia de moneda sin un click cuando hay plata en pantalla.** Si la persona vacía
  los campos, el aviso solo cambia de texto (*"Ya no queda ningún monto cargado…"*) y sigue
  esperando. ⚠️ La versión que en ese caso se aplicaba sola hacía que **borrar un campo para
  retipearlo**, o **cambiar la unidad** (que lo vacía), cambiaran la moneda sin confirmación.
  ⭐ **Un aviso pendiente no sobrevive a un gesto nuevo sobre el mismo selector**, y la regla va
  en **una línea al principio del handler**: *cualquier* elección resuelve el aviso anterior
  —incluso la que aplica sin preguntar, y la de la moneda que ya estaba puesta—. Escrita como
  guards separados, uno por cada forma de salir, se escapa; el caso que deja es un aviso
  huérfano que **vacía plata recién tipeada sin cambiar ninguna moneda**. También muere con el
  formulario que lo pidió: cerrar el drawer, guardar, cambiar el tipo.
  ⭐ **El aviso solo nombra lo que el tipo actual muestra, y con su origen verdadero.** `form`
  conserva lo tipeado para un tipo anterior —un costo cargado como producto sigue ahí después
  de pasar a servicio, invisible y sin guardarse—, así que **cada espejo replica el `v-if` de
  su campo**: receta y combo también traen `costoActual` de la API, y sin el corte por tipo el
  aviso nombra un "Costo vigente" que esos drawers no muestran. Al **aplicar** sí se vacía lo
  escondido: se avisa por lo que se puede ver perder, se limpia por lo que puede volver.
  📌 **Y un `0` no se cuenta ni se vacía**: cero es cero en cualquier moneda, y un extra gratis
  es un caso soportado —vaciarle el precio lo deja sin un campo que el DTO exige—. El descarte
  usa `Decimal`, no truthiness: `'0.0000'` es truthy.
  ⚠️ La confirmación va **inline** y no en un `CrudModal` como el resto de la pantalla: abrir
  cualquier `UModal` con ese drawer abierto **sigue** tumbando al runner de tests por memoria
  (medido; la capa es `UDrawer` — ver § 15). **Cerrar ESTE drawer ya no es obstáculo** desde el
  2026-09-11: el wrapper de `getComputedStyle` de § 15 lo deja cerrar con exit 0 —medido con y
  sin wrapper **en esta pantalla**; el otro spec que lo usa, `salones`, ya lo traía—, y la
  entrada del backlog se cerró en
  [`resueltos.md`](../agent/resueltos.md). Fijado en
  `items.nuxt.spec.ts`; la **etiqueta** del selector mostrando la moneda vieja mientras se
  decide sigue en `e2e/configuracion/items-moneda.spec.ts`. ⚠️ Lo que **ningún** entorno
  discrimina —medido por mutante— es si el pendiente lo mata el cierre o la reapertura:
  `abrirEditar` llama a `resetDrawer()` igual, así que comentar el `watch` del cierre deja los
  tests en verde.
  📌 La otra mitad del problema de la **unidad** es **visual**: un "Costo vigente" en unidad base al
  lado de un "Costo nuevo (por g)" son dos números que no se pueden comparar. El vigente
  sigue al selector, y como es una **tasa convertida** puede caer en fracciones que la
  moneda no tiene → se formatea con **`formatCosto`** (`useCurrency`) y no con
  `formatMonto`: los decimales de la moneda son el **piso**, no el techo, hasta
  `ESCALA_COSTO` = 4. ⚠️ Solo para **lectura**. En un campo editable la escala la manda
  la moneda, porque lo que se teclea se cobra.

Archivos: `app/stores/monedas.ts`, `app/types/moneda.ts`,
`app/utils/currency-format.ts` (+ `.spec.ts`, `formatMontoDisplay` para montos y
`formatCostoDisplay` para tasas), `app/composables/useCurrency.ts`,
`app/composables/useFormatters.ts`, `app/components/MoneyInput.vue`.

Tests: `cd frontend && npm test -- --run app/utils/currency-format.spec.ts app/stores/monedas.spec.ts`

---

## 8.1 Verificación manual (pantallas de configuración)

Login como admin → `/configuracion/<feature>`: ver datos, probar toggle (con revert
ante error simulado), mover la estrella, crear/editar/eliminar. Confirmar que los
`message` del backend aparecen en los toasts.

**Monedas / precios:** una sola llamada `GET /monedas` en Network tras login;
catálogo POS muestra CLP sin decimales y USD con separador US; `MoneyInput` formatea
mientras se escribe; totales de venta/caja usan moneda oficial.

Ver [backend.md](./backend.md) para la API que consume esta capa.

---

## 9. Tabla editable con add/remove de filas (tramos)

Array inmutable — nunca mutar directamente:

```typescript
function agregarTramo() {
  form.value.tramos = [...form.value.tramos, { minimo: '', valorMonto: '', valorPorcentaje: '' }]
}
function eliminarTramo(i: number) {
  form.value.tramos = form.value.tramos.filter((_, idx) => idx !== i)
}
```

En el template, `<tr v-for="(tramo, i) in form.tramos" :key="i">` con `UInput`
`inputmode="decimal"` por celda y `UButton i-lucide-trash-2` para eliminar (ver §7).

---

## 10. Pantalla POS (dos paneles + carrito con recálculo)

Para pantallas complejas con múltiples paneles orquestados, ver
`app/pages/ventas/index.vue`. Patrón clave: **helpers puros testeables en
`composables/useVenta.ts`** (funciones sin Nuxt/Vue, 100% Vitest) + composable
reactivo que los envuelve con `computed`. Componentes pequeños (`CarritoPanel`,
`CobroModal`, `ClienteForm`) que no contienen lógica sino que la consumen de arriba.

### 10.1 El resultado del cálculo va atado al carrito que lo produjo

Los tres carritos (POS, tienda, salones) muestran el desglose que devuelve
`POST /calculo-precios/calcular` y lo cruzan con las líneas **por índice**. El
índice es lo correcto —dos líneas del mismo ítem con distinta personalización no
se distinguen por `itemId`— pero solo sirve mientras el resultado corresponda al
carrito que se está viendo, y entre el cambio y la respuesta hay una ventana.

`useResultadoCalculado()` (en `app/composables/useCalculoPrecios.ts`) es el único
lugar donde vive ese estado. Recibe un **getter del input** y devuelve
`{ resultado, loading, vigente, recalcular, asegurarVigente, limpiar }`:

- **`vigente`** es derivado: compara la clave del input actual contra la del
  input que produjo el resultado guardado. No es un flag que alguien tenga que
  acordarse de bajar, así que no depende del orden de las llamadas.
- **el token de request** descarta respuestas obsoletas: dos `calcular`
  solapados no dejan que la vieja pise a la nueva.

Cómo se consume:

- **Advertencias** (atribuidas a una línea concreta) se dibujan solo con
  `vigente`; los totales conservan el último valor conocido para que no
  parpadeen en cada tecla.
- **Todo lo que mueve plata** —abrir el modal de cobro, imprimir precuenta o
  boleta, el Pagar de la tienda— llama `await asegurarVigente()`. Lo que se
  **construye** con el cálculo (los ítems del ticket, los totales impresos, la
  proyección local de la caja) usa **lo que devuelve**, no `resultado.value`
  releído después. Si devuelve `null` no se sigue **con lo que dependía del
  cálculo** —no se abre el cobro, no se imprime— **y se avisa**: quedarse sin el
  cálculo en el camino del dinero no puede ser silencioso. Lo ya cobrado se
  registra igual: la venta se emite y la cuenta se cierra aunque no salga el
  ticket, porque el backend calcula su propio total y el cliente ya pagó.
  El `:total` que muestra el modal de cobro sí sigue al ref, y es seguro porque
  el modal solo se abre con el cálculo vigente y el carrito no cambia mientras
  está abierto.
- **El botón NO se gatea por `vigente`.** El clic ya espera `asegurarVigente()`,
  que además reintenta si el cálculo había fallado. Gatearlo deja la pantalla
  trabada tras un fallo de red: botón gris, sin mensaje y sin forma de reintentar.
- **Un cálculo que falla no borra el resultado guardado.** La vigencia ya dice si
  sirve; borrarlo deja el total en cero por un error de red, y `totalFinal` es un
  computed vivo: puede pasar con el modal de cobro ya abierto.
- **`debounceMs`** solo para los carritos que cambian tecla a tecla (POS,
  tienda). Salones muta por request y llama `recalcular()` explícito.
- **`persistKey`** solo para el carrito que sobrevive la navegación (tienda):
  usa `useState` en vez de refs locales. El token de request va con él —el
  composable se instancia en tres páginas y todas escriben el mismo estado.

---

## 12. Listados paginados (server-side)

Para tablas con dataset grande: paginar en backend, no en cliente.

```typescript
const filtroEstado = ref<string | undefined>()
const listFilters = computed(() => ({ ventaEstado: filtroEstado.value }))

const { items, meta, page, pageSize, loading } = usePaginatedList<Item>({
  path: '/pagos',
  pageSize: 15,
  filters: listFilters,
})
```

- `page` es 1-based (alineado con `UPagination`); al cambiar filtros → reset a
  página 1 y refetch automático; errores vía `useToast`.
- UI: `<UTable :data="items" :columns="columns" />` + `UPagination`
  (`v-model:page`, `:items-per-page`, `:total="meta.total"`). **Sin** TanStack
  `getPaginationRowModel`.
- KPIs/resumen: endpoint dedicado (`GET /pagos/resumen`), cargado una vez en
  `onMounted`, independiente de filtros/página.
- Filtros: preferir `USelectMenu` con IDs del backend en vez de búsqueda texto.

Referencia: `app/pages/pagos/index.vue`, `app/pages/configuracion/items.vue`.

---

## 13. Preferencias de usuario

Composable `useUserPreferences()` — lee/escribe `authStore.user.preferencias`.

| Pref | Default | Persistencia |
|------|---------|--------------|
| `pageSize` | 15 | Solo servidor (`PATCH /me/preferencias`) |
| `colorMode` | light | Cookie `@nuxtjs/color-mode` + mirror servidor |

UI en `/configuracion/perfil` → `UserPreferencesForm`; plugin
`plugins/color-mode-sync.client.ts` aplica el tema del servidor tras `fetchMe`;
cambios sincronizados con debounce 300 ms. Uso:
`usePaginatedList({ path, pageSize, filters })` con el `pageSize` del composable.

---

## 14. Coordinar skill `frontend-design` con `nuxt-ui` / tokens semánticos

Orden de trabajo (siempre): **1)** `frontend-design` decide dirección estética
(paleta 4-6 hex nombrados, tipografía, layout, elemento firma) → **2)** traducir ese
plan a `frontend/app.config.ts` **antes** de escribir componentes → **3)** `nuxt-ui`
construye con componentes reales consumiendo esos tokens.

Puntos de choque (resueltos por ese orden):
- **Hex sueltos:** la paleta nunca se escribe literal en un `.vue` (nada de
  `bg-[#F4F1EA]`); se mapea a escalas `primary`/`neutral` o alias semánticos en
  `app.config.ts` (patrón `text.highlighted`).
- **CSS bespoke:** preferir prop `ui`/`class` del componente; markup verdaderamente
  custom va en componente propio con `<style scoped>`, nunca selectores globales
  (revisar `.nuxt/ui/<component>.ts` antes de escribir CSS custom).
- **Orden de invocación entre skills:** el flujo de 3 pasos de arriba.

---

## 15. Tests de render de componentes

Los helpers puros van a composables y se testean ahí (§10). Lo que **no** se puede extraer
—qué renderiza el template, qué llega por props, qué sale por eventos— se cubre montando el
componente.

Spec al lado del fuente: `app/components/Foo.spec.ts` junto a `app/components/Foo.vue`.
Corre con `npm test`, que ya está en CI.

**Cómo se monta:** `mount` plano de `@vue/test-utils` con `global.stubs` explícitos para los
componentes `U*`. Con `mount` plano el error medido es `[nuxt] instance unavailable`: los
componentes de Nuxt UI llaman `useNuxtApp()`/`useAppConfig()` en su propio `setup()` y
revientan antes de renderizar nada. Con `mountSuspended` y entorno `nuxt` el contexto Nuxt sí
queda disponible —ese error desaparece— pero la falla persiste con otra causa: `UTooltip`
necesita además un `TooltipProviderContext`, que en la app real lo provee `UApp` en la raíz.
Envolver el montaje en `UApp` **no se probó**; se descartó por costo/beneficio frente al stub
explícito, no por imposibilidad medida.

Dos formas de stub, según lo que el test necesite inspeccionar:
- `UIcon: true` y similares cuando alcanza con que el componente esté presente — VTU los
  renderiza como `u-icon-stub`, `u-button-stub`.
- stub con template propio cuando hay que inspeccionar un elemento real, p. ej. `UInput`
  renderizando un `<input>` de verdad para poder leer su `value`. Está en `MoneyInput.spec.ts`.

**La convención que importa: las aserciones se atan al tag renderizado del stub** (o al
elemento real que el stub renderiza), **nunca a un selector de atributo genérico**. Es lo
único que hace fallar el test cuando el tag del componente está mal escrito (`<UIconn>` por
`<UIcon>`). Está medido que `vue-tsc --noEmit` **no** caza ese typo: salida vacía, exit 0.

Costo de la capa: `npm test` pasó de 275 tests en 24 archivos a 291 en 28, de 3.7 s a ~4 s de
reloj.

**Qué afirma un test de render:**

- lo que ve el usuario: texto renderizado, cuántos elementos aparecen;
- el caso vacío — que **no renderice nada**;
- `aria-label` y texto accesible;
- eventos emitidos;
- **fallthrough de atributos**: que la `class` que pasa el padre aterrice en el root. Un
  componente cuyo único nodo raíz es un `v-for` compila a `Fragment` y Vue **descarta el
  `class` en silencio** — ese bug es invisible para build, typecheck y lint.

**Qué NO afirma:**

- **clases de estilo** (`text-warning`, `truncate`, `size-3.5`). Es afirmar la
  implementación, y happy-dom no calcula layout, así que el assert no valida nada. No hay
  gate estático para el truncado: la relación ancestro/descendiente que decide si rompe
  (ver §16) no se puede ver mirando una sola línea del template — solo se detecta midiendo
  layout real en navegador;
- **snapshots**. Congelan markup y se aprueban a ciegas cuando cambian.

**Un test no cuenta hasta fallar contra su estado previo o su mutación.** Romper la línea
nueva solo prueba que el test la toca; hay que revertir al comportamiento anterior y ver el
rojo. Si un mutante deja todo en verde, eso **es** el hallazgo: ese código no está cubierto.

**Store de Pinia:** `setActivePinia(createPinia())` en un `beforeEach` y sembrar con el
método de hidratación del store —`useMonedasStore().hydrate(list, tenantId)`—, que es el
patrón de `app/stores/monedas.spec.ts`. Sin `@pinia/testing`. Además hace falta
`vi.mock('#app/nuxt', ...)` para `useRuntimeConfig`, porque el store lo llama en su cuerpo.
El patrón completo está en `app/stores/monedas.spec.ts` y en `MoneyInput.spec.ts`.

**Límites conocidos:**

- happy-dom **no calcula layout**: no hay anchos ni overflow. Nada de lo que dependa de
  medir se puede afirmar acá.
- Un componente `U*` que llama `useAppConfig()`/`useNuxtApp()` en su `setup()` no monta sin
  contexto Nuxt, **aunque sea el root del componente bajo test**. La salida es stubearlo con
  template propio: así se cubrió `AppDrawer`, cuyo root es `UDrawer`. El diagnóstico
  inicial —que la causa era el teleport— **era incorrecto**: la falla ocurre en `setup()`,
  antes de cualquier render o teleport.
- Riesgo del propio patrón: un stub con template propio puede volverse tan permisivo que el
  test pase por construcción. La contraprueba es la mutación — si romper el componente bajo
  test no pone nada en rojo, el test está afirmando el stub y no el componente.

### Spec de PÁGINA que CIERRA un drawer

Un spec de página (`mountSuspended`) que **cierra** un `AppDrawer` **real** —y sin
el wrapper de `getComputedStyle` de más abajo— deja `vitest run` en **exit 1**
aunque todos los tests pasen: la transición de salida de `usePresence` (reka-ui)
lee `style.display` de un nodo ya desprendido y tira un *unhandled rejection*, que
vitest cuenta aparte bajo `Errors` y no en la línea de `Tests`.

Medido aislando una variable (2026-08-07, `configuracion/garzones`): abrir el
drawer y desmontar → **0** rejections, exit 0. Abrir, guardar —que hace
`drawerOpen = false`— y desmontar → **2** por test, exit 1. Rompe el cierre, no
el montaje.

La salida es stubear `AppDrawer` en **`global: { stubs: … }` del propio mount**.
⚠️ Medido, porque acá había una creencia instalada al revés: `global.stubs` **sí**
intercepta los componentes auto-importados de Nuxt bajo `mountSuspended` —tanto
`AppDrawer`, usado directo por la página, como `UDrawer`, anidado dentro de él—.
Por eso **no** hace falta `mockComponent`, que además alcanza a todo el archivo y
puede stubear el drawer de otros `describe` sin avisar.

Dos consecuencias del stub que cuestan un rato descubrir:

- **El montaje necesita `attachTo: document.body`** si en el drawer hay un botón
  `type="submit" form="…"`: esa asociación por id la resuelve el *documento*, y
  con el wrapper desprendido el submit no dispara. Con el `UDrawer` real no se
  nota porque teletransporta al body. Verificado por mutación: sacar `attachTo`
  mata los tests.
- **El contenido stubeado NO se teletransporta**, así que sus botones se buscan
  en el wrapper y no en `document.body` como los de un `UModal`.

**La otra salida, para cuando el test NECESITA cerrar el drawer de verdad** —p. ej. recorrer
el flujo que hace una persona: elegir algo, cerrar, y volver a entrar—: envolver
`window.getComputedStyle` para que lo que devuelva quede fuera de la reactividad de Vue. El
objeto vivo de happy-dom **ya es** un Proxy suyo; `usePresence` lo guarda en un `ref` y Vue
le pone otro encima, y el doble proxy rompe los traps. `markRaw` lo deja con uno solo:

```ts
let original: typeof window.getComputedStyle
beforeAll(() => {
  original = window.getComputedStyle
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    markRaw(original.call(window, el, pseudo) as object)) as typeof window.getComputedStyle
})
afterAll(() => { window.getComputedStyle = original })
```

Va **LOCAL al archivo**, nunca en `test.setup.ts`: es un global de toda la suite y para esto
no hace falta tocarlo. Está en `configuracion/salones.nuxt.spec.ts:35-43`, en
`configuracion/items.nuxt.spec.ts` y en `salones/index.nuxt.spec.ts`.

**La medición, el 2026-09-11 sobre `configuracion/items`**, cada falla aislada con `-t` y el
exit code leído sin pipe —`| tail` se come el status—: el test que cierra el drawer da **exit 1
con 2 rejections** sin el wrapper y **exit 0** con él, y el archivo entero pasó de 49 a 50 tests
**sin mover ninguno**, que es el riesgo de parchear un global a nivel de archivo.

⚠️ **Hasta dónde llega eso**: la medición con y sin wrapper es **solo de
`configuracion/items`**. El otro spec que lo usa, `configuracion/salones`, ya lo traía —su
docblock (`:19-34`) explica la causa, pero no registra exit codes— y las demás pantallas con
drawer no se midieron. Alcanza para tomarlo como **la salida cuando un test necesita cerrar**,
no para prometer que cualquier drawer del repo cierra limpio.

⚠️ **Antes de inventar una evasión, buscar la que ya existe.** Acá no va ningún total a
propósito —ni de archivos ni de formas—: un conteo envejece y hace que el próximo deje de
buscar. Lo que sigue son las formas que **aparecieron al barrer `frontend/app`**, cada una
comentada donde vive y con el porqué que midió quien la escribió —no re-medido acá, y alguno
puede haber envejecido con su spec—; ninguna es un error. Si encontrás otra, se suma acá.

- **Stubear `AppDrawer`**, en specs de página (`garzones`, `impuestos`, `mermas`,
  `inventario/index`, `inventario/traslados`, `inventario/recuentos/index`, `salones/index`) y
  también en specs del drawer como componente (`caja/CajaCierreDrawer`,
  `ventas/VentaDetalleDrawer`).
- **Stubear `UDrawer` con template propio** —no con `true`— cuando lo que se prueba **es** el
  drawer: `components/AppDrawer.spec.ts:11-26`, cuyo stub trae un botón que emite
  `update:open`, así que el test cierra **por el drawer**. ⚠️ Con `AppDrawer` stubeado también
  se puede cerrar, pero **no porque el stub lo haga solo**: o lo emite el test sobre la
  instancia (`salones/index.nuxt.spec.ts:3246`), o se guarda y la página pone
  `drawerOpen = false` (`garzones.nuxt.spec.ts:747-749`, cuyo stub ni declara `emits`). Para un
  spec de página el de `AppDrawer` alcanza; este otro va cuando el sujeto es el drawer mismo.
- **Stubear el componente que CONTIENE el drawer**, cuando el drawer tiene su propio spec:
  `caja/CajaCierreForzadoPanel.nuxt.spec.ts:39-42` (`CajaCierreDrawer: true`).
- **Entrar por un camino que pasa por el mismo código sin cerrar el drawer**: "Nuevo" en vez
  de "Cancelar", que llama igual a `resetDrawer` (`descuentos`, `recargos`).
- **Hacer fallar la escritura a propósito** para que el drawer no se cierre (`descuentos` y
  `recargos` con el `PATCH`, `promociones` con el `POST`).
- **Retener la promesa sin resolver**, que no es lo mismo que hacerla fallar (`ubicaciones`,
  `guardarRetenido`).
- **Purgar del `body` los `[role="dialog"]` colgados**, en el `beforeEach` del describe que lo
  necesita —no del archivo—: `unmount()` **no** se lleva el contenido teleportado
  (`grupos-modificadores.nuxt.spec.ts:591-596`, `recargos.nuxt.spec.ts:591`,
  `inventario/index.nuxt.spec.ts:247-251`, `configuracion/items.nuxt.spec.ts:1696`; en
  `promociones.nuxt.spec.ts:161` vive en un `reset()` que sí llaman los cinco describes). No
  evita el cierre: evita que un test lea el drawer del anterior.

⚠️ **La trampa del dialog fantasma**, que es la razón de la purga: si el `body` puede tener
drawers colgados de tests anteriores, buscar el **primer** `[role="dialog"]` agarra el viejo, y
un test que dice "cerrar" pasa sin cerrar nada. Se purga el `body` antes de cada test, o se
ancla al **más reciente** —el mecanismo está explicado en
`configuracion/salones.nuxt.spec.ts:285-293`, con el helper `dialogo()` al lado (`:294-297`): el viejo queda colgado y el nuevo se teletransporta al
final—. ⚠️ Y el ancla por posición **no se verifica sola**: afirmar además que el dialog elegido
es el que se cree —por su texto— hace que un ancla equivocada **falle** en vez de cerrar un
fantasma y pasar igual. Ojo que si los fantasmas tienen el mismo texto, eso tampoco discrimina:
la garantía es la purga, y el texto es defensa en profundidad.

Si el test **necesita** cerrar el drawer, la salida es el wrapper de arriba; si no lo
necesita, la evasión más barata del caso sigue siendo válida. ⚠️ **Pero una evasión tiene
precio, y es el que se olvida:** un camino que no cierra el drawer **no puede afirmar nada
sobre el cierre**, y el mutante no lo delata —cae igual, porque abrir y cerrar comparten
`resetDrawer`—. Está escrito en `descuentos.nuxt.spec.ts:1196-1199`, y un test que diga
"cerrar" sin cerrar queda midiendo la apertura.

⚠️ **Ese wrapper NO alcanza para abrir un `UModal` con el drawer abierto**: eso tumba al
worker por memoria (`FATAL ERROR: Reached heap limit`) a los ~92 s, con el test reportado
como *skipped* y exit 1. Medido el mismo día, una variable por corrida:

| escenario | exit |
|---|---|
| el modal solo, sin drawer | 0 |
| modal con el drawer **real** abierto | 1 — heap |
| ídem **+ el wrapper `markRaw`** | 1 — heap |
| modal con `AppDrawer` stubeado | 0 |
| modal con **solo `UDrawer`** stubeado (`AppDrawer` real, todo el contenido montado) | 0 |

La última fila es la que nombra al culpable: **la capa `UDrawer`** —vaul + el
`Dialog`/`Presence` de reka—, y **no** la página, ni el volumen de su template (sigue montado
bajo ese stub), ni el modal. Mientras siga así: una confirmación que tenga que convivir con
el drawer abierto va **inline** en el cuerpo (`UAlert`), y un test que necesite un modal
sobre el drawer stubea esa capa.

### Spec del COMPONENTE drawer (no de la página que lo abre)

Montar el drawer directo —`mountSuspended(VentaDetalleDrawer, …)`— agrega dos
trampas propias, las dos medidas el 2026-08-28:

- **Se monta CERRADO y se abre después.** El `watch` que dispara la carga mira
  `[open, ventaId]` y **no es `immediate`**: un drawer que nace con `open: true`
  nunca pide su dato y el spec renderiza el estado vacío ("No se encontró la
  venta") sin fallar. La forma correcta reproduce lo que hace la app:
  `props: { open: false }` y después `await wrapper.setProps({ open: true })`.
- **El fallback del mock de `useApiFetch` devuelve `[]`, nunca `null`.** El
  drawer dispara `ensureLoaded()` de stores que al spec no le importan
  (`useUnidadesMedidaStore`), y esos stores **asignan lo que venga**: con `null`
  el store queda en `null` y explota más tarde adentro de una `computed`, como
  *unhandled rejection*. Medido: `vitest run` en **exit 1** y los 4 tests en rojo
  por una URL que el spec ni nombra. Hidratar el store a mano **no** hace falta
  —`unidades` arranca en `[]` y `esFraccionaria` tiene fallback—: lo único que
  hace falta es que el mock no devuelva `null`. (Verificado sacando el `hydrate`:
  sigue en verde.)

⚠️ De los dos casos: leer la última línea de `npm test` **no alcanza**. Un spec
puede decir "4 passed" y salir 1. Se mira el exit code.

---

## 16. `truncate` + `min-w-0`: cuándo hace falta y cuándo es ruido

Medido en navegador real (Chromium/Playwright, jul-2026), no regla folk. Por Flexbox
§4.5, el mínimo automático de un ítem flex/grid es **cero** cuando su propio `overflow`
computado no es `visible` — y `truncate` de Tailwind incluye `overflow: hidden`.

- **El elemento que lleva `truncate` es él mismo el ítem flex (hijo directo)** → ya
  encoge solo, su propio `overflow: hidden` fija el mínimo en cero. `min-w-0` ahí **no
  aporta nada** — es ruido, no hace falta agregarlo ni mantenerlo. **Medido en flex**: un
  `<span class="truncate">` (con o sin `flex-1`, con o sin `min-w-0` de más) dentro de un
  host de 300px con texto de 650px renderizados — las tres variantes truncan idéntico
  (contenedor 300px, `scrollWidth` 300, el propio elemento a 280px). En **grid** no se
  midió esta forma (solo se midió la rota y su fix, abajo) — no asumir que se comporta
  igual sin medir.
- **`truncate` está en un descendiente de un ítem flex/grid** (p. ej. un `<p>` dentro de un
  `<div class="flex-1">`) → ahí sí hace falta `min-w-0` en el ítem ancestro — **medido, en
  flex y en grid**. `truncate` implica `white-space: nowrap`, así que el min-content de
  ese bloque es el ancho **completo** del texto; sin `min-w-0` el ítem se niega a encoger
  y desborda él y toda la fila:
  - **Flex, sin `min-w-0`** (`<div class="flex-1"><p class="truncate">`, host de 300px,
    texto de 650px): el host **desborda** — `scrollWidth` 670 > `clientWidth` 300; el
    `<p>` mide 650px de ancho.
  - **Flex, con `min-w-0`** (`<div class="flex-1 min-w-0"><p class="truncate">` — el
    patrón real del repo): trunca — `scrollWidth` 300 == `clientWidth` 300.
  - **Grid, sin `min-w-0`** (columna `1fr auto`, ítem sin `min-w-0`, `truncate` en el
    hijo): **desborda** — `scrollWidth` 650 > `clientWidth` 300.
  - **Grid, con `min-w-0`**: trunca — `scrollWidth` 300 == `clientWidth` 300.
  - `flex-1` en el wrapper es irrelevante para el bug: un wrapper pelado (`<div>` sin
    `flex-1` ni `min-w-0`, simple hijo directo de un contenedor flex) rompe igual —
    `scrollWidth` 670 > `clientWidth` 300 — porque ser "ítem flex" lo determina el
    `display` del padre, no las clases del propio elemento.

  Cualquier otro `overflow` distinto de `visible` **debería** funcionar igual que
  `min-w-0` por la spec de Flexbox §4.5 (el mínimo automático es cero cuando el
  `overflow` propio del ítem no es `visible`) — pero eso es **inferencia, no medición**:
  solo se midió `min-w-0`. Usar `min-w-0`, que es lo verificado; no sustituirlo por otro
  `overflow` sin medir primero.

```vue
<!-- ✅ min-w-0 hace falta: el div (ítem flex) es ANCESTRO del <p> que trunca -->
<div class="flex-1 min-w-0">
  <p class="truncate">{{ nombre }}</p>
</div>

<!-- ✅ min-w-0 es ruido: el propio span que trunca YA es el ítem flex -->
<span class="flex-1 truncate">{{ nombre }}</span>
```

No hay gate estático para esto: la relación ancestro/descendiente cruza líneas distintas
del template, y un chequeo línea-a-línea no puede verla (por eso se borró el intento que
hubo en `check-design-tokens.mjs` — ver `docs/agent/resueltos.md`). Ante la duda, medir en
navegador con contenido largo, no aplicar la regla por reflejo.

**Barrido pre-fix vs. post-fix (por qué el patrón seguro no necesita vigilancia):**
angostando el contenedor real del carrito de 360px a 50px, con y sin `min-w-0`/`shrink-0`
en el markup de `AdvertenciasPrecio`, las dos versiones dieron **fila por fila el mismo
resultado**: el título nunca desbordó por encima de ~90px de contenedor en ninguna de las
dos, y el botón del tooltip se sale por debajo de 90px **en ambas versiones por igual**
(lo congela su propio min-content de 24px al resolver la violación de mínimos de
Flexbox, no `shrink-0`). Confirma que el patrón "truncate es el propio ítem flex" no
necesita `min-w-0` ni `shrink-0` para comportarse bien.

Quién vigila esto en CI: `frontend/e2e/layout/desborde.spec.ts`. El detector no busca la
clase `.truncate` (implementación de Tailwind, puede cambiar) sino el **efecto**
(`white-space: nowrap` + `overflow-x: hidden` computados); ubica su ítem flex/grid
ancestro más cercano (el elemento inmediato cuyo *padre* es flex/grid — sea o no el
propio elemento que trunca) y falla solo si ese ítem tiene `overflow-x: visible` **y**
algún ancestro suyo desborda de verdad (`scrollWidth > clientWidth`). Así ignora los
`.truncate` ya seguros (item = él mismo) y no confunde un desborde de layout ajeno
(p. ej. un contenedor con ancho fraccionario de una librería de terceros) con el bug de
esta regla, aunque ese contenedor también tenga descendientes truncados en algún lado.

---

## 17. Refresco periódico (`useRefrescoPeriodico`)

Primer refresco periódico del sistema (dashboard de inicio, zona "Ahora" — spec
`2026-09-18-dashboard-inicio-design.md` § 6). Para un bloque que muestra un estado en
vivo (turno, cajas abiertas) y necesita refrescarse solo sin que la persona recargue la
página, **no una pantalla completa con paginación/filtros** (eso sigue siendo
`usePaginatedList`, §12).

```typescript
const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => useApiFetch<T>(`${apiUrl}/…`),
  { intervaloMs: 60_000 }, // default; opcional
)
```

- Carga al invocarse (**no** `onMounted`: el composable se invoca directo en el
  `<script setup>` del bloque) y después cada `intervaloMs`, **solo si
  `document.visibilityState === 'visible'`**. Un `visibilitychange` a visible dispara
  una carga extra, para no dejar la pantalla con un dato viejo hasta el próximo tick.
- **Un fallo NO reintenta antes del próximo ciclo** — regla de producto, no límite
  técnico: el owner no quiere que la app repita sola una acción que falló (memoria
  `sin-reintento-automatico`). Conserva el último `datos` y marca `sinConexion`; la
  pantalla muestra un aviso ("Sin conexión — se reintenta en el próximo ciclo") **sin
  borrar el dato**. Una carga exitosa apaga `sinConexion` y actualiza `actualizadoEl`
  (mostrado con `formatHora` de `useFormatters`, "Actualizado HH:MM").
- **Un 403 marca `oculto` y DETIENE el intervalo** — no es una falla de red, es un
  módulo que el tenant no contrató. Insistir no lo arregla. El status se lee con el
  mismo idioma que `apiErrorMsg`/`useApiFetch`: `err?.status ?? err?.response?.status`.
  El componente esconde el bloque entero (`v-if="!oculto"`) sin mostrar error — la
  razón de fondo (spec § 6): el frontend no tiene cómo distinguir "el tenant no
  contrató este módulo" de "a este admin no le tocaría verlo", porque
  `/rbac/mis-permisos` le devuelve `[]` a un admin y el `v-if` de la página lo deja
  pasar igual por `esAdmin` — el 403 en vivo es la única señal que sí lo sabe.
- `onScopeDispose` limpia el intervalo y el listener de `visibilitychange`: no
  sobrevive al bloque que lo agendó (mismo criterio que el debounce de
  `useCalculoPrecios.ts` — `if (getCurrentScope()) onScopeDispose(...)`).
- Sin dependencias nuevas: no hay `@vueuse/core` en `package.json`, y no hace falta
  para esto.

**Qué NO resuelve:** no es para carga inicial simple (eso es un `onMounted` con
`useApiFetch` liso) ni para un botón "Actualizar" manual sin ciclo automático — para
eso, `refrescar()` expuesto alcanza sin el `setInterval` (llamarlo directo desde el
handler del botón).

Referencia: `app/composables/useRefrescoPeriodico.ts` +
`useRefrescoPeriodico.spec.ts`; consumido por `app/components/inicio/InicioSalon.vue`,
`InicioCajas.vue`, `InicioCierres.vue` (`docs/features/dashboard-inicio.md`).

---

## 18. Cobrar con clave de idempotencia (`useIntentoCobro`)

Toda pantalla que llama a un endpoint que cobra (`POST /ventas`, `POST /cuentas/:id/cerrar`,
`POST /pagos`) manda la cabecera `Idempotency-Key` de `useIntentoCobro`
([ADR-026](../adr/026-idempotencia-de-cobros.md)).

```ts
const intentoCobro = useIntentoCobro()   // en el setup: usa useToast
const AMBITO = 'pos'                      // o `cuenta:${id}` / `abono:${ventaId}`

try {
  const res = await useApiFetch(url, { method: 'POST', body, headers: intentoCobro.cabecera(AMBITO) })
  intentoCobro.terminar(AMBITO)           // entró (o ya había entrado): el intento terminó
  toast.add({ title: 'Venta pagada', color: 'success' })
  intentoCobro.avisarSiRepetido(res)      // "Este cobro ya había entrado…"
} catch (e) {
  if (intentoCobro.mostrarSiCobroConOtrosDatos(e, AMBITO)) return   // 422 + "Ver venta"
  // …el manejo de error de siempre
}
```

- **La clave NO se regenera al editar** el carrito ni los pagos. Si se regenerara, cambiar
  tarjeta por efectivo después de un corte sacaría una segunda venta en vez del 422.
- **Muere con `terminar`:** con el éxito, cuando el carrito queda vacío (el POS lo mira con un
  `watch` sobre `lineas.length`) o al salir de la página (la pasarela, en `onUnmounted`). El
  422 de "otros datos" también la mata: el Confirmar siguiente es una venta nueva (owner,
  2026-09-19).
- **El ámbito sale de la foto, no de un `ref` vivo.** En el salón es la cuenta que congeló el
  cobro (`cuenta:${cuentaCerrada.id}`), leída antes del `await`.
- **`useIntentoCobro()` se llama en el setup**, nunca después de un `await`: usa `useToast`,
  que hace `inject` + `useState`.
- **Sin reintento automático.** El que vuelve a confirmar es el cajero.
- **Tests:** el mock de `useApiFetch` guarda `opts.headers['Idempotency-Key']` por request, y
  el spec afirma "misma clave tras un error" y "otra clave tras el éxito". Como el estado vive
  a nivel de módulo, el `beforeEach` llama a `useIntentoCobro().terminar(<ámbito>)`.

