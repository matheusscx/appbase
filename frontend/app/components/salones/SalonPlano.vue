<script setup lang="ts">
import type { MesaResumen } from '~/composables/useSalones'
import { mesasSePisan } from '~/utils/mesa-dimensiones'

const props = withDefaults(
  defineProps<{
    mesas: MesaResumen[]
    editable?: boolean
    selectedId?: string | null
  }>(),
  { editable: false, selectedId: null },
)

const emit = defineEmits<{
  /** Nueva posición fraccional de una mesa mientras/tras arrastrarla. */
  move: [mesaId: string, posX: number, posY: number]
  /** Selección de mesa (modo operación). */
  select: [mesa: MesaResumen]
  /** Doble click sobre una mesa (modo edición) para abrir su edición. */
  edit: [mesa: MesaResumen]
  /** Se soltó una mesa tras arrastrarla (hubo movimiento real). */
  dragend: [mesaId: string]
  /**
   * La mesa quedó encima de al menos otra. **Avisa, no impide**: el plano no se
   * corrompe ni bloquea nada —cada mesa sigue siendo direccionable por su id—,
   * solo queda confuso, y frenar el arrastre en un lienzo libre pelea con el
   * usuario. Quien escucha decide cómo mostrarlo.
   */
  solape: [mesaId: string, nombres: string[]]
}>()

const plano = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragMoved = ref(false)

// Alto del plano ajustado por el usuario (resize-y), persistido en localStorage
// para no perderlo al recargar. No es reactivo a propósito: si fuera un ref, Vue
// reescribiría el style en cada render y pisaría el resize nativo del navegador.
const ALTO_STORAGE_KEY = 'salones-plano-alto'

function leerAltoGuardado(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(ALTO_STORAGE_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

const altoInicial = leerAltoGuardado()
let resizeObserver: ResizeObserver | null = null

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function posFromEvent(e: PointerEvent): { x: number, y: number } | null {
  const el = plano.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  }
}

function onPointerDown(e: PointerEvent, mesa: MesaResumen) {
  if (!props.editable) return
  e.preventDefault()
  draggingId.value = mesa.id
  dragMoved.value = false
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!draggingId.value) return
  const pos = posFromEvent(e)
  if (pos) {
    dragMoved.value = true
    emit('move', draggingId.value, pos.x, pos.y)
  }
}

/**
 * Nombres de las mesas que la recién soltada está pisando.
 *
 * Se evalúa acá y no en el backend porque **el servidor no tiene los píxeles**:
 * la posición se persiste como fracción del contenedor y el tamaño se dibuja en
 * px fijos, así que el solapamiento depende del ancho real del plano. Ver
 * `~/utils/mesa-dimensiones`.
 */
function mesasPisadas(mesaId: string): string[] {
  const el = plano.value
  if (!el) return []
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return []
  const movida = props.mesas.find((m) => m.id === mesaId)
  if (!movida) return []
  return props.mesas
    .filter((m) => m.id !== mesaId && mesasSePisan(movida, m, rect))
    .map((m) => m.nombre)
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  if (draggingId.value && dragMoved.value) {
    const pisadas = mesasPisadas(draggingId.value)
    if (pisadas.length) emit('solape', draggingId.value, pisadas)
    emit('dragend', draggingId.value)
  }
  draggingId.value = null
  dragMoved.value = false
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

onMounted(() => {
  if (!props.editable || !plano.value) return
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    window.localStorage.setItem(ALTO_STORAGE_KEY, String(Math.round(entry.contentRect.height)))
  })
  resizeObserver.observe(plano.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

function onSelect(mesa: MesaResumen) {
  if (props.editable) return
  emit('select', mesa)
}

function onDblClick(mesa: MesaResumen) {
  if (!props.editable) return
  emit('edit', mesa)
}
</script>

<template>
  <div
    ref="plano"
    class="relative h-[420px] max-h-[70vh] min-h-[220px] w-full overflow-auto rounded-lg border border-default bg-muted"
    :class="editable ? 'resize-y' : ''"
    :style="altoInicial ? { height: `${altoInicial}px` } : undefined"
  >
    <p
      v-if="mesas.length === 0"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted"
    >
      No hay mesas en este salón.
    </p>

    <div
      v-for="mesa in mesas"
      :key="mesa.id"
      class="absolute -translate-x-1/2 -translate-y-1/2 touch-none"
      :style="{ left: `${Number(mesa.posX) * 100}%`, top: `${Number(mesa.posY) * 100}%` }"
      :data-qa="`mesa-${mesa.id}`"
      @pointerdown="onPointerDown($event, mesa)"
      @click="onSelect(mesa)"
      @dblclick="onDblClick(mesa)"
    >
      <SalonesMesaNode
        :mesa="mesa"
        :editable="editable"
        :selected="selectedId === mesa.id"
      />
    </div>
  </div>
</template>
