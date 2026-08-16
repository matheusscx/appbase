<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { EventoPin, Garzon, TipoGarzon } from '~/composables/useGarzones'

const TIPO_GARZON_OPTIONS: { label: string, value: TipoGarzon }[] = [
  { label: 'Garzón', value: 'garzon' },
  { label: 'Cocina', value: 'cocina' },
  { label: 'Barra', value: 'barra' },
]

function labelTipo(tipo: TipoGarzon): string {
  return TIPO_GARZON_OPTIONS.find(o => o.value === tipo)?.label ?? tipo
}

/**
 * Con cuenta el encargado invalida y no ve nada: el garzón pone su propio PIN
 * desde su perfil. Sin cuenta, el sistema es dueño del PIN y el encargado
 * genera uno nuevo y lo revela. Un solo botón/flujo, no dos: manda el estado
 * del garzón, así el encargado no puede elegir el que no corresponde.
 */
function esInvalidar(garzon: Garzon): boolean {
  return garzon.usuarioId !== null
}

/**
 * El MISMO texto en el botón de la fila, el título del modal y su botón de
 * confirmar — antes eran tres rótulos distintos para la misma acción
 * ("Generar PIN nuevo" / "Regenerar PIN" / "Generar nuevo PIN") y el
 * encargado abría una cosa y leía otra.
 */
function regenerarLabel(garzon: Garzon): string {
  return esInvalidar(garzon) ? 'Invalidar PIN' : 'Generar PIN nuevo'
}

// La lectura es abierta (`Salones:Leer`), pero cada escritura pega a un endpoint
// con su propio `@RequiresPermiso`. Garzones NO tiene módulo propio: sus rutas
// piden permisos de **Salones**. `Salones:Operar` no entra acá — es de la
// operación (`garzones/verificar-pin`, cuentas), no de esta pantalla.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

const toast = useToast()
const garzonesApi = useGarzones()

// El toggle "ver eliminados" y el restaurar van los dos detrás de
// `Salones:Eliminar`: `POST /garzones/:id/restaurar` exige ese permiso, así
// que ofrecer la papelera sin él sería prometer una acción que termina en 403.
const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('garzones')

const garzones = ref<Garzon[]>([])
const loading = ref(false)

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `garzones.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla no usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      garzones.value = await garzonesApi.listar(verEliminados.value)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar garzones'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Garzon) {
  const idx = garzones.value.findIndex(g => g.id === saved.id)
  if (idx >= 0) {
    garzones.value[idx] = { ...garzones.value[idx], ...saved }
  }
  else {
    garzones.value.push(saved)
  }
  garzones.value = [...garzones.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  garzones.value = garzones.value.filter(g => g.id !== id)
}

onMounted(async () => {
  await Promise.all([cargar(), cargarMiembros()])
})

async function cargarMiembros() {
  // Con `catch` como su hermana `cargar()`: sin él, un fallo de la carga deja el
  // selector VACÍO y sin explicación, y el admin concluye que no hay cuentas
  // vinculables cuando lo que falló fue la carga.
  //
  // `para-selector` y no `members`: esta pantalla no es admin-only, y el roster
  // completo trae el correo de cada miembro. Acá solo hacen falta los nombres.
  try {
    miembros.value = await useApiFetch<typeof miembros.value>(
      `${useRuntimeConfig().public.apiUrl}/tenants/members/para-selector`,
    )
  }
  catch (e: unknown) {
    toast.add({
      title: apiErrorMsg(e, 'No se pudieron cargar las cuentas del tenant'),
      color: 'error',
    })
  }
}

// ── Crear / editar garzón ──────────────────────────────────────────────────
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{
  nombre: string
  activo: boolean
  tipo: TipoGarzon
  usuarioId: string | null
}>({
  nombre: '',
  activo: true,
  tipo: 'garzon',
  usuarioId: null,
})

/**
 * Miembros del tenant, para el vínculo opcional del modo personal.
 *
 * Se cargan una vez al montar y no al abrir el drawer: son pocos y no cambian
 * mientras se edita un garzón.
 */
const miembros = ref<{ usuarioId: string, nombre: string, apellido: string, esTotem: boolean }[]>([])

/**
 * Proxy entre el `undefined` que usa `USelectMenu` para "nada elegido" y el
 * `null` que el backend necesita para **desvincular**.
 *
 * No son sinónimos en el DTO: ausente significa "no toques el vínculo" y `null`
 * es "sacalo". Sin esta traducción, vaciar el selector no desvincularía nada.
 */
const usuarioVinculado = computed<string | undefined>({
  get: () => form.value.usuarioId ?? undefined,
  set: (v) => { form.value.usuarioId = v ?? null },
})

/**
 * Cuentas ofrecibles: ni marcadas tótem ni **ya vinculadas a otro garzón**. Las
 * dos son error del backend, así que ofrecerlas sería hacerle descubrir la
 * regla al admin chocándose — y la de "ya vinculada" era un 500 hasta que se le
 * puso mensaje.
 */
const miembrosVinculables = computed(() => {
  // Cuentas tomadas por OTRO garzón. La del garzón que se está editando no
  // cuenta: si no, al abrir el drawer su propia cuenta desaparecería del
  // selector y parecería desvinculada.
  // Solo garzones VIVOS: el índice único es parcial sobre `eliminado_el IS
  // NULL`, así que la cuenta de uno borrado está libre y el backend la acepta.
  // Contarla acá dejaría el selector más restrictivo que la regla.
  const tomadas = new Set(
    garzones.value
      .filter(g => g.usuarioId && !g.eliminadoEl && g.id !== editingId.value)
      .map(g => g.usuarioId),
  )
  return miembros.value
    .filter(m => !m.esTotem && !tomadas.has(m.usuarioId))
    .map(m => ({
      // El fallback era `|| m.correo`, y el correo dejó de venir. No se cae sin
      // más: `@MinLength(1)` acepta un nombre en blanco, y una opción con label
      // vacío no se puede elegir a ciegas.
      label: `${m.nombre} ${m.apellido ?? ''}`.trim() || 'Sin nombre',
      value: m.usuarioId,
    }))
})
const saving = ref(false)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar garzón' : 'Nuevo garzón',
)

/**
 * El aviso del alta dice la verdad en los DOS casos, y depende del selector de
 * cuenta de este mismo formulario: `crear()` emite PIN solo cuando NO viene
 * `usuarioId` (`garzones.service.ts`: `const pin = dto.usuarioId ? null : …`).
 * El texto fijo de antes prometía "se generará un PIN para que se lo
 * entregues" también con cuenta elegida — justo lo contrario de lo que pasa.
 */
const textoPinAlta = computed(() =>
  form.value.usuarioId
    ? 'No se generará ningún PIN: al tener cuenta vinculada, lo fija esa persona '
      + 'desde su perfil y vos nunca lo ves.'
    : 'Al crear el garzón se generará automáticamente un PIN de 6 dígitos y se '
      + 'mostrará una sola vez para que se lo entregues.',
)

// ── Estado del PIN, para la ficha (edición de un garzón con cuenta) ────────
// Se ata al garzón que la lista YA tiene (`garzonEnEdicion`), no al valor en
// curso del selector del formulario: si el admin cambia el vínculo sin
// guardar, el historial mostrado sigue siendo el de la cuenta que de verdad
// tiene el PIN hoy, no el de una edición todavía no confirmada.
const garzonEnEdicion = computed(() =>
  editingId.value ? garzones.value.find(g => g.id === editingId.value) ?? null : null,
)
const eventosPin = ref<EventoPin[]>([])
// El total del servidor, no `eventosPin.length`: el backend topea la lista, así
// que derivarlo del array diría "5 de 5" cuando hay 200. Ese silencio es
// exactamente lo que la decisión del owner descartó al elegir "topear con aviso".
const totalEventosPin = ref(0)
const cargandoEventosPin = ref(false)
// Distingue "cargó y no hay eventos" (real: un garzón creado YA vinculado
// por API —`crear()` con `usuarioId`— no emite PIN y por lo tanto no
// registra ningún evento, `garzones.service.ts`: `guardarConEvento(garzon,
// null)` cuando `pin` es `null`) de "no se pudo cargar". Sin esto, un fetch
// fallido deja `eventosPin` en `[]` y la lista dice "Todavía no hubo cambios
// de PIN" — que en ESE caso sería mentira, aunque en el del garzón recién
// vinculado por API sea la verdad.
const errorEventosPin = ref(false)

/**
 * Viene del backend (`GarzonPublico.pinFijado`, ya cargado por `listar()`),
 * NO del historial: derivarlo de `eventosPin` lo dejaba a merced de un fetch
 * que puede estar en curso o haber fallado, y con `eventosPin: []` en
 * cualquiera de los dos casos el badge decía "Sin PIN todavía" con la misma
 * cara que si el backend lo hubiera confirmado.
 */
const pinFijado = computed(() => garzonEnEdicion.value?.pinFijado ?? false)

/**
 * Los tres estados del badge dicen cosas distintas porque la SALIDA de cada
 * uno es distinta, y el rótulo tiene que apuntar a quién la ejecuta:
 *
 * - **con cuenta + PIN puesto** → nada que hacer.
 * - **con cuenta + sin PIN** → lo pone la persona desde su perfil. "todavía"
 *   es correcto: se está esperando algo que sí va a poder hacer sola.
 * - **sin cuenta + sin PIN** → la persona **no puede hacer nada**
 *   (`fijarMiPin` resuelve por `usuario_id` y le da 404) y **no puede
 *   operar por ningún lado**: el tótem compara su PIN contra el centinela y
 *   el modo personal necesita el vínculo que no tiene. Solo sale de ahí si
 *   el encargado le genera un PIN. Decirle "Sin PIN todavía" a ese caso
 *   subestima la consecuencia y sugiere una espera que no se va a resolver
 *   sola, así que el rótulo nombra el efecto y el color lo separa de la
 *   espera normal.
 */
const badgePin = computed<{ color: 'success' | 'warning' | 'error', label: string }>(() => {
  if (pinFijado.value) return { color: 'success', label: 'PIN puesto' }
  if (garzonEnEdicion.value?.usuarioId) return { color: 'warning', label: 'Sin PIN todavía' }
  return { color: 'error', label: 'Sin PIN: no puede operar' }
})

async function cargarEventosPin(id: string) {
  cargandoEventosPin.value = true
  errorEventosPin.value = false
  try {
    const pagina = await garzonesApi.listarEventosPin(id)
    eventosPin.value = pagina.eventos
    totalEventosPin.value = pagina.total
  }
  catch (e: unknown) {
    errorEventosPin.value = true
    toast.add({ title: apiErrorMsg(e, 'No se pudo cargar el historial del PIN'), color: 'error' })
  }
  finally {
    cargandoEventosPin.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = { nombre: '', activo: true, tipo: 'garzon', usuarioId: null }
  eventosPin.value = []
  errorEventosPin.value = false
  drawerOpen.value = true
}

function abrirEditar(garzon: Garzon) {
  if (garzon.eliminadoEl) return
  editingId.value = garzon.id
  form.value = {
    nombre: garzon.nombre,
    activo: garzon.activo,
    tipo: garzon.tipo ?? 'garzon',
    usuarioId: garzon.usuarioId ?? null,
  }
  eventosPin.value = []
  errorEventosPin.value = false
  // Para TODOS los garzones, con cuenta o sin ella (decisión del owner,
  // 2026-08-15). `emitido_en_alta` y `regenerado_por_encargado` son los
  // únicos eventos que produce un garzón SIN cuenta, y esta ficha es la
  // única pantalla que puede mostrarlos: su perfil no existe (`miPin`
  // resuelve por `garzonPersonalDe`, que exige `usuario_id` → 404). Y es
  // justo el caso que justifica el log — "Pedro le regeneró el PIN a Ana
  // tres veces esta semana" solo puede pasar SIN cuenta, porque con cuenta
  // el encargado no regenera, invalida.
  //
  // Sin superficie nueva: `GET /garzones/:id/pin-eventos` pide
  // `Salones:Leer`, el mismo permiso con el que ya se lee esta ficha.
  //
  // ⚠️ Cero N+1: la llamada cuelga de ABRIR LA FICHA, nunca del render de
  // la tabla. Una por apertura, no una por fila — lo fija el test "cero
  // N+1: el listado no pide ningún historial, y abrir una ficha pide
  // exactamente el de ESE garzón".
  cargarEventosPin(garzon.id)
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    if (editingId.value) {
      const { advertencias, ...saved } = await garzonesApi.actualizar(editingId.value, {
        nombre: form.value.nombre,
        activo: form.value.activo,
        tipo: form.value.tipo,
        // Se manda siempre, incluido `null`: en el DTO, ausente significa "no
        // toques el vínculo" y `null` es "desvinculá". Omitirlo cuando el
        // selector se vacía dejaría el vínculo vivo.
        usuarioId: form.value.usuarioId,
      })
      upsertLocal(saved)
      toast.add({ title: 'Garzón actualizado', color: 'success' })
      // El cambio se guardó; lo que la advertencia dice es que puede no regir
      // todavía (sesión abierta con el tipo congelado). Mismo patrón que el POS
      // con las advertencias de la venta: éxito primero, avisos después.
      for (const advertencia of advertencias) {
        toast.add({ title: advertencia, color: 'warning' })
      }
      drawerOpen.value = false
    }
    else {
      const creado = await garzonesApi.crear({
        nombre: form.value.nombre,
        activo: form.value.activo,
        tipo: form.value.tipo,
        // `undefined` y no `null`: en el alta no existe "desvincular" —la fila
        // todavía no está—, así que ausente es el único modo de decir "sin
        // cuenta". Omitirlo del todo, como se hacía antes, DESCARTABA en
        // silencio la cuenta que el encargado acababa de elegir en el
        // selector de abajo.
        usuarioId: form.value.usuarioId ?? undefined,
      })
      const { pin, advertencias, ...garzon } = creado
      upsertLocal(garzon)
      drawerOpen.value = false
      // `pin: null` = se creó CON cuenta y el backend no emitió ninguno: lo
      // fija la persona desde su perfil. Abrir el modal de revelado con un
      // hueco donde va el número sería peor que no abrirlo — mismo criterio
      // que `confirmarRegenerar`.
      //
      // Las advertencias, en el ALTA, salen siempre por toast: `crear()` solo
      // empuja una cuando viene `usuarioId` (la de "esa cuenta no puede operar
      // el salón"), que es exactamente el caso en que `pin` es `null`. O sea
      // que la rama del modal recibe siempre `[]` y pasárselas es defensa, no
      // un flujo que ocurra. Distinto de `confirmarRegenerar`, donde el
      // garzón SIN cuenta sí recibe la advertencia de sesión abierta junto
      // con un PIN que revelar, y por eso ahí van dentro del modal.
      if (pin !== null) {
        revelarPin(creado.nombre, pin, advertencias)
      }
      else {
        toast.add({
          title: `${creado.nombre} quedó vinculado a su cuenta: pone su propio PIN desde su perfil`,
          color: 'success',
        })
        for (const advertencia of advertencias) {
          toast.add({ title: advertencia, color: 'warning' })
        }
      }
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el garzón'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Regenerar PIN ──────────────────────────────────────────────────────────
const regenerarOpen = ref(false)
const regenerarTarget = ref<Garzon | null>(null)
const regenerando = ref(false)
/** Id del garzón cuya fila está esperando el refresco de `abrirRegenerar`. */
const abriendoRegenerarId = ref<string | null>(null)

/**
 * Refresca el listado ANTES de armar el modal: `garzones.value` no se
 * repuebla solo (nada de polling, nada de refetch al volver a la pestaña),
 * así que sin esto la ventana en la que `pinFijado` —y por lo tanto qué
 * PREGUNTA hacer— puede quedar vieja no tiene límite mientras la pantalla
 * siga abierta. Es una llamada disparada por una acción deliberada del
 * usuario (un click), no polling ni N+1.
 *
 * Sigue quedando una carrera entre ESTE refresco y el click en "Confirmar"
 * —inevitable, cualquier snapshot puede envejecer el instante después de
 * leerlo— pero ya no importa: el RESULTADO que el encargado ve después de
 * confirmar sale de `habiaPin`, que manda el backend en la respuesta del
 * propio `PATCH` (`confirmarRegenerar`, más abajo), no de este dato. Acá
 * solo se decide qué preguntar, nunca qué pasó.
 */
async function abrirRegenerar(garzon: Garzon) {
  if (garzon.eliminadoEl) return
  abriendoRegenerarId.value = garzon.id
  try {
    await cargar()
  }
  finally {
    abriendoRegenerarId.value = null
  }
  const fresco = garzones.value.find(g => g.id === garzon.id)
  // Pudo haberse eliminado entre el click y que el refresco volviera. Sin el
  // toast, el spinner del botón para y no pasa nada más — el encargado se
  // queda sin saber por qué.
  if (!fresco || fresco.eliminadoEl) {
    toast.add({
      title: `${garzon.nombre} ya no está disponible: se eliminó justo antes de que confirmaras`,
      color: 'warning',
    })
    return
  }
  regenerarTarget.value = fresco
  regenerarOpen.value = true
}

/**
 * Título y confirm-label: el mismo rótulo que el botón de la fila
 * (`regenerarLabel`), así el encargado no abre "Generar PIN nuevo" y lee
 * "Regenerar PIN" en el título.
 */
const regenerarTitle = computed(() =>
  regenerarTarget.value ? regenerarLabel(regenerarTarget.value) : '',
)
/**
 * Confirm-label: igual al título en los dos casos que de verdad son "la
 * misma acción con un solo nombre" (generar / invalidar-que-destruye). El
 * caso "con cuenta y sin PIN fijado" tiene el SUYO propio — "Invalidar PIN"
 * ahí prometería lo que el mensaje explícitamente niega dos líneas arriba.
 */
const regenerarConfirmLabel = computed(() => {
  const g = regenerarTarget.value
  if (g && esInvalidar(g) && !g.pinFijado) return 'Registrar igual'
  return regenerarTitle.value
})

/**
 * El mensaje tiene TRES casos, no dos — el segundo hallazgo de la revisión
 * anterior era exactamente esto: "invalidar" para un garzón CON cuenta que
 * TODAVÍA no fijó su PIN no destruye nada (el backend ya lo dejó
 * `pinHash = PIN_INUTILIZABLE` al vincularlo), así que prometerle "pierde el
 * tótem compartido" es mentira. `pinFijado` (arriba, viene de
 * `GarzonPublico`, no del historial) es lo que permite distinguir los dos
 * casos "con cuenta".
 *
 * ⚠️ Y ninguno de los tres promete que la persona "puede seguir trabajando
 * desde su dispositivo" (revisión final, 2026-08-15). Eso es cierto solo si
 * su cuenta tiene `Salones:Operar` —sin ese permiso el `PermisosGuard` le
 * cierra los 6 puntos del modo personal—, y esta pantalla no tiene ese
 * dato: el listado (`GarzonPublico`) no lo trae. Lo que sí es cierto
 * siempre es lo que se pierde —el tótem compartido, hasta que el garzón
 * fije su PIN—, y eso es lo único que se afirma. Mismo recorte, por el
 * mismo motivo, en `regenerarPin` (`garzones.service.ts`) y en
 * `MiPinForm.vue`.
 */
const regenerarMensaje = computed(() => {
  const g = regenerarTarget.value
  if (!g) return ''
  if (!esInvalidar(g)) {
    return `Se generará un PIN nuevo para ${g.nombre} y se mostrará una sola vez. El PIN anterior dejará de funcionar de inmediato.`
  }
  if (g.pinFijado) {
    return `El PIN de ${g.nombre} deja de servir ahora. No vas a ver ningún número: ${g.nombre} pone el suyo desde su cuenta. Hasta que lo haga, pierde el tótem compartido.`
  }
  return `${g.nombre} todavía no puso su PIN, así que no hay ninguno que invalidar. Queda registrado que lo pediste.`
})
const regenerarConfirmColor = computed(() => {
  const g = regenerarTarget.value
  if (!g || !esInvalidar(g)) return 'primary'
  return g.pinFijado ? 'error' : 'neutral'
})

async function confirmarRegenerar() {
  if (!regenerarTarget.value) return
  regenerando.value = true
  try {
    const res = await garzonesApi.regenerarPin(regenerarTarget.value.id)
    regenerarOpen.value = false
    // La respuesta trae el garzón COMPLETO y fresco (`GarzonPinRegenerado
    // extends Garzon`), `pinFijado` incluido — invalidar SÍ desfija
    // (`garzones.service.ts`: `pinHash = PIN_INUTILIZABLE`). Sincronizarlo
    // acá deja el listado al día para la próxima vez que se abra este modal
    // o la ficha de este garzón.
    const { pin, advertencias, habiaPin, ...garzonActualizado } = res
    upsertLocal(garzonActualizado)
    // `pin: null` = no hay número que mostrar (se invalidó, o no había nada
    // que invalidar). Abrir el modal de revelado con un hueco donde va el
    // número sería peor que no abrirlo: se avisa por toast, que es lo que de
    // verdad pasó.
    if (pin !== null) {
      revelarPin(res.nombre, pin, advertencias)
    }
    else if (habiaPin) {
      // `habiaPin` sale del backend, NO del `pinFijado` que la pantalla tenía
      // al abrir el modal: ese dato es una PREDICCIÓN —refrescada recién en
      // `abrirRegenerar`, pero puede envejecer mientras el modal sigue
      // abierto y el encargado decide—. El resultado que se le informa acá
      // no puede depender de una predicción que pudo quedar vieja; tiene que
      // salir de lo que el backend hizo de verdad en este mismo request.
      toast.add({ title: `PIN de ${res.nombre} invalidado`, color: 'success' })
      advertencias.forEach(a => toast.add({ title: a, color: 'warning' }))
    }
    else {
      // No había credencial que destruir: no se le puede llamar "invalidado"
      // a esto sin mentir. El evento igual queda en la auditoría (decisión
      // del owner) — el toast lo refleja.
      toast.add({
        title: `${res.nombre} todavía no había puesto su PIN: no había nada que invalidar`,
        color: 'neutral',
      })
      advertencias.forEach(a => toast.add({ title: a, color: 'warning' }))
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al regenerar el PIN'), color: 'error' })
  }
  finally {
    regenerando.value = false
  }
}

// ── Revelado del PIN (una sola vez) ─────────────────────────────────────────
const pinReveladoOpen = ref(false)
const pinRevelado = ref<{ nombre: string, pin: string, advertencias: string[] }>({
  nombre: '',
  pin: '',
  advertencias: [],
})

/**
 * Las advertencias del backend van DENTRO de este modal, no en un toast: son
 * sobre el PIN que se está mostrando ("está en turno, pasáselo ya") y acá es
 * donde el admin está mirando. Un toast detrás del modal se pierde.
 *
 * `pin` es siempre un PIN real: los dos llamadores (`guardar()` al crear,
 * `confirmarRegenerar()` al regenerar) filtran antes el caso `null` —cuando
 * el garzón tiene cuenta vinculada, ese caso se resuelve con un toast, no acá.
 */
function revelarPin(nombre: string, pin: string, advertencias: string[] = []) {
  pinRevelado.value = { nombre, pin, advertencias }
  pinReveladoOpen.value = true
}

// ── Eliminar ───────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Garzon | null>(null)

function confirmarEliminar(garzon: Garzon) {
  if (garzon.eliminadoEl) return
  toDelete.value = garzon
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await garzonesApi.eliminar(id)
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocal(id)
    }
    toast.add({ title: 'Garzón eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar el garzón'), color: 'error' })
  }
  finally {
    deleteOpen.value = false
    toDelete.value = null
  }
}

// ── Restaurar ────────────────────────────────────────────────────────────────
// SIN modal de colisión: la única colisión posible de `garzones` es el
// placeholder "Mostrador" (índice único parcial, no de nombre) y renombrar no
// la resuelve — un 400 acá es siempre terminal (toast), nunca una pregunta.
// `docs/features/papelera.md` § "garzones tiene una restricción única parcial
// distinta". Tampoco se arregla el riesgo aceptado de PIN duplicado al
// restaurar: documentado en la misma sección, `restaurar()` no puede
// compararlo porque el PIN solo existe hasheado.
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
}

async function restaurarGarzon(id: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id)
    const g = garzones.value.find(x => x.id === id)
    if (g) {
      g.eliminadoEl = null
      g.eliminadoPorNombre = null
    }
    toast.add({ title: 'Garzón restaurado', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
    cerrarRestaurar()
  }
  finally {
    restaurando.value = false
  }
}

const columns: TableColumn<Garzon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'activo', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Garzones"
      description="Registra los garzones del local con un PIN de 6 dígitos para identificarlos al abrir y cerrar cuentas en dispositivos compartidos."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Salones:Eliminar` el
               backend rechaza el restaurar, así que mostrar la papelera sería
               ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
            Nuevo garzón
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="garzones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-default">{{ row.original.nombre }}</span>
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

      <template #tipo-cell="{ row }">
        <UBadge color="neutral" variant="subtle" size="xs">
          {{ labelTipo(row.original.tipo ?? 'garzon') }}
        </UBadge>
      </template>

      <template #activo-cell="{ row }">
        <UBadge
          :color="row.original.activo ? 'success' : 'neutral'"
          variant="subtle"
          size="xs"
        >
          {{ row.original.activo ? 'Activo' : 'Inactivo' }}
        </UBadge>
      </template>

      <template #acciones-cell="{ row }">
        <div v-if="row.original.eliminadoEl" class="flex justify-end">
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            @click="() => { confirmRestaurarId = row.original.id; confirmRestaurarModalOpen = true }"
          >
            Restaurar
          </UButton>
        </div>
        <div v-else class="flex items-center justify-end gap-1">
          <!-- `PATCH :id/pin`: mismo permiso que editar. El rótulo lo decide
               el garzón (`regenerarLabel`), no una elección libre del
               encargado: con cuenta vinculada invalida, sin cuenta genera. -->
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-key-round"
            color="neutral"
            variant="ghost"
            :title="regenerarLabel(row.original)"
            :aria-label="regenerarLabel(row.original)"
            :loading="abriendoRegenerarId === row.original.id"
            @click="abrirRegenerar(row.original)"
          />
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            aria-label="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            aria-label="Eliminar"
            @click="confirmarEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay garzones. Crea el primero para empezar.
        </div>
      </template>
    </CrudTable>

    <!-- Drawer crear/editar -->
    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="garzon-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="Ana Torres"
              :maxlength="100"
              autofocus
            />
          </UFormField>
          <UFormField label="Tipo" required>
            <USelect
              v-model="form.tipo"
              :items="TIPO_GARZON_OPTIONS"
              value-key="value"
              label-key="label"
            />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
          <!-- El vínculo es opcional a propósito: sin él, el garzón sigue
               operando por PIN, que es lo que permite sumar personal temporal
               sin crearle una cuenta. -->
          <UFormField
            label="Cuenta vinculada"
            hint="Opcional"
            description="Si opera desde su propia tablet, entra con su cuenta y no teclea PIN. Sin vincular, se identifica con PIN como siempre."
          >
            <USelectMenu
              v-model="usuarioVinculado"
              :items="miembrosVinculables"
              value-key="value"
              placeholder="Sin vincular (usa PIN)"
              class="w-full"
            />
          </UFormField>
          <!-- DEBAJO del selector, no arriba: lo que dice depende de lo que
               el encargado acaba de elegir ahí. -->
          <p v-if="!editingId" class="text-sm text-muted">
            {{ textoPinAlta }}
          </p>
        </UForm>

        <!-- `garzonEnEdicion` y no `editingId`: en el alta no hay ficha ni
             historial que mostrar. Para TODOS los garzones desde el
             2026-08-15 (decisión del owner) — ver `abrirEditar`. -->
        <template v-if="garzonEnEdicion">
          <USeparator class="my-4" />
          <div class="space-y-2">
            <!-- Se muestra SIEMPRE que no haya PIN usable —con cuenta o sin
                 ella— y además en el caso "con cuenta y PIN puesto".
                 El único que se esconde es "sin cuenta y con PIN usable":
                 ahí "PIN puesto" significaría "lo puso la PERSONA", que es
                 justo lo que un garzón sin cuenta nunca hizo.

                 ⚠️ Esconderlo para TODO garzón sin cuenta (como estaba hasta
                 el 2026-08-15) se apoyaba en una premisa falsa: que un
                 garzón sin cuenta siempre tiene un PIN emitido por el
                 sistema. **Desvincular lo desmiente**, y se llega desde este
                 mismo formulario vaciando el selector: `actualizar()` pisa
                 `pinHash` SOLO en la transición `null → uuid`
                 (`garzones.service.ts`, `vinculaCuenta` exige
                 `dto.usuarioId !== null`), así que un garzón dado de alta
                 CON cuenta y después desvinculado queda `usuarioId: null` Y
                 `pinFijado: false`. Esa persona no puede operar por ningún
                 lado —el tótem le compara contra el centinela y el modo
                 personal necesita el vínculo— y no puede arreglarlo sola
                 (`fijarMiPin` le da 404 sin `usuario_id`): depende de que el
                 encargado le genere uno. Es el estado que MÁS hay que ver, y
                 era el que quedaba invisible. -->
            <div v-if="!pinFijado || garzonEnEdicion.usuarioId" class="flex items-center gap-2">
              <span class="text-sm font-medium text-default">PIN</span>
              <UBadge :color="badgePin.color" variant="subtle">
                {{ badgePin.label }}
              </UBadge>
            </div>
            <div>
              <p class="mb-2 text-sm font-medium text-default">
                Historial
              </p>
              <p v-if="cargandoEventosPin" class="text-sm text-muted">
                Cargando…
              </p>
              <!-- Distinto de la lista vacía: `[]` por un fetch fallido NO es
                   "todavía no hubo cambios" (ver `errorEventosPin`). -->
              <p v-else-if="errorEventosPin" class="text-sm text-error">
                No se pudo cargar el historial del PIN.
              </p>
              <GarzonesPinEventosLista v-else :eventos="eventosPin" :total="totalEventosPin" />
            </div>
          </div>
        </template>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="garzon-form" :loading="saving">
          {{ editingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <!-- Confirmar regeneración/invalidación de PIN -->
    <CrudModal
      v-model:open="regenerarOpen"
      :title="regenerarTitle"
      :message="regenerarMensaje"
      :confirm-label="regenerarConfirmLabel"
      :confirm-color="regenerarConfirmColor"
      :loading="regenerando"
      @cancel="regenerarTarget = null"
      @confirm="confirmarRegenerar"
    />

    <!-- Revelado del PIN (una sola vez) -->
    <UModal
      v-model:open="pinReveladoOpen"
      :title="`PIN de ${pinRevelado.nombre}`"
      :ui="shellUi.modal"
    >
      <template #body>
        <div class="space-y-4">
          <code class="block text-center text-3xl font-semibold tracking-[0.4em] tabular-nums bg-elevated rounded px-3 py-3">{{ pinRevelado.pin }}</code>
          <p class="text-sm text-warning">
            <UIcon name="i-lucide-triangle-alert" class="size-4 align-text-bottom" />
            Guárdalo ahora — <strong>no se volverá a mostrar</strong>. Si se
            pierde, genera uno nuevo.
          </p>
          <!-- Del backend: hoy, que el garzón está en turno y el PIN viejo ya
               dejó de funcionar. Va acá y no en un toast porque es sobre este
               PIN y sobre la urgencia de entregarlo. -->
          <UAlert
            v-for="advertencia in pinRevelado.advertencias"
            :key="advertencia"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock-alert"
            :description="advertencia"
          />
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton label="Entendido" @click="() => { pinReveladoOpen = false }" />
        </AppModalFooter>
      </template>
    </UModal>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar garzón"
      message="Se eliminará el garzón. Las cuentas ya registradas conservan su trazabilidad."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />

    <!-- Restaurar: SIN modal de colisión, ver el comentario junto a
         `restaurarGarzon`. Cualquier error es terminal y se avisa por toast. -->
    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar garzón"
      message="¿Restaurar este garzón? Volverá a aparecer en el listado y podrá identificarse con su PIN de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarGarzon(confirmRestaurarId)"
    />
  </div>
</template>
