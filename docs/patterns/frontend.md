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
| Features operativas | `items`, `terceros`, POS, `recetas-desfases`, inventario, recuentos, mermas… y, dentro de `configuracion/`, `garzones`, `impresoras`, `salones` y `turnos` | `@RequiresPermiso` → gate por control |

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
// `permisoLabel` solo si el módulo se llama distinto en pantalla:
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'MiCaja:Leer',
  permisoLabel: 'Mi caja',
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

Archivos: `app/stores/monedas.ts`, `app/types/moneda.ts`,
`app/utils/currency-format.ts` (+ `.spec.ts`), `app/composables/useCurrency.ts`,
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
  form.value.tramos = [...form.value.tramos, { minimo: '', valor: '' }]
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

Un spec de página (`mountSuspended`) que **cierra** un `AppDrawer` deja
`vitest run` en **exit 1** aunque todos los tests pasen: la transición de salida
de `usePresence` (reka-ui) lee `style.display` de un nodo ya desprendido y tira
un *unhandled rejection*, que vitest cuenta aparte bajo `Errors` y no en la línea
de `Tests`.

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
