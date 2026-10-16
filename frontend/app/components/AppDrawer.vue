<script setup lang="ts">
import type { DrawerProps } from '@nuxt/ui'
import { resolveDrawerWidth, type DrawerWidth } from '~/utils/drawer-width'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
  /** Preset (`xs`–`full`) o valor CSS (`50%`, `75%`, `28rem`). Solo aplica a `left`/`right`. */
  width?: DrawerWidth
  handle?: boolean
  inset?: boolean
  ui?: Record<string, unknown>
}>(), {
  direction: 'right',
  width: 'md',
  handle: false,
})

const open = defineModel<boolean>('open', { default: false })

// Cambios sin guardar (auditoría UX 07.13): Escape, un clic al lado o "Cancelar" tiraban lo
// tipeado sin preguntar. Se detecta tocando cualquier campo del cuerpo (`input`/`change` burbujean);
// solo el cierre que pide la persona pregunta: el cierre programático tras guardar no pasa por acá.
const tocado = ref(false)
const confirmando = ref(false)
watch(open, (abierto) => {
  if (abierto) {
    tocado.value = false
    confirmando.value = false
  }
})

function alPedirCambioDeEstado(abierto: boolean) {
  if (!abierto && tocado.value) {
    confirmando.value = true
    return
  }
  open.value = abierto
}

function descartar() {
  confirmando.value = false
  tocado.value = false
  open.value = false
}

// "Cancelar" vive en el slot `actions` de cada pantalla y cierra poniendo su propio ref en false:
// se intercepta el clic antes de que llegue. Se reconoce por su texto, que es el mismo en toda la app.
function alClicEnPie(e: MouseEvent) {
  if (!tocado.value || confirmando.value) return
  const boton = (e.target as HTMLElement | null)?.closest('button')
  if (boton?.textContent?.trim() === 'Cancelar') {
    e.stopPropagation()
    e.preventDefault()
    confirmando.value = true
  }
}

const isHorizontal = computed(
  () => props.direction === 'left' || props.direction === 'right',
)

const drawerContent = computed<DrawerProps['content']>(() => {
  if (!isHorizontal.value) return undefined
  const size = resolveDrawerWidth(props.width)
  // reka reenvía `style` al elemento de contenido en runtime; el tipo del prop `content`
  // (DialogContentProps) no modela `style`, así que casteamos el objeto.
  // Piso de 28rem a los porcentajes: a 768 px el 50 % dejaba 384 y los valores elegidos se
  // truncaban (auditoría UX 07.6).
  const ancho = size.endsWith('%') ? `max(28rem, ${size})` : size
  return {
    style: {
      width: ancho,
      maxWidth: 'calc(100vw - 1rem)',
    },
  } as DrawerProps['content']
})

const drawerUi = computed(() => {
  const defaults = {
    content: 'h-full min-h-0',
    container: 'w-full h-full min-h-0 flex flex-col overflow-hidden divide-y divide-accented',
    header: 'shrink-0 px-6 py-4',
    body: 'flex-1 min-h-0 overflow-y-auto px-6 py-4',
    footer: 'shrink-0 mt-auto px-6 py-4 flex flex-row items-center justify-between gap-2 bg-default w-full',
  }
  const custom = props.ui ?? {}
  return {
    ...defaults,
    ...custom,
    content: [defaults.content, custom.content].filter(Boolean).join(' '),
    container: [defaults.container, custom.container].filter(Boolean).join(' '),
    header: [defaults.header, custom.header].filter(Boolean).join(' '),
    body: [defaults.body, custom.body].filter(Boolean).join(' '),
    footer: [defaults.footer, custom.footer].filter(Boolean).join(' '),
  }
})
</script>

<template>
  <UDrawer
    :open="open"
    v-bind="$attrs"
    :title="title"
    :description="description"
    :direction="direction"
    :handle="handle"
    :inset="inset"
    :content="drawerContent"
    :ui="drawerUi"
    @update:open="alPedirCambioDeEstado"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    <template v-if="$slots.body" #body>
      <!-- `@container`: a 768 px el panel mide ~400 y las grillas de dos columnas pasan a una. -->
      <div
        class="@container @max-md:[&_.grid-cols-2]:grid-cols-1"
        @input="tocado = true"
        @change="tocado = true"
      >
        <slot name="body" />
      </div>
    </template>
    <template v-if="$slots.actions || $slots.footer" #footer>
      <div
        v-if="confirmando"
        class="flex w-full flex-col gap-3"
        role="alertdialog"
        aria-label="Cambios sin guardar"
      >
        <p class="text-sm text-default">
          Tienes cambios sin guardar. ¿Salir sin guardar?
        </p>
        <div class="flex w-full flex-row items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" data-qa="drawer-seguir" @click="() => { confirmando = false }">
            Seguir editando
          </UButton>
          <UButton color="error" data-qa="drawer-descartar" @click="descartar">
            Descartar
          </UButton>
        </div>
      </div>
      <!-- Captura (no `@click`): intercepta "Cancelar" antes que su propio handler; no es un control nuevo. -->
      <div v-else class="flex w-full flex-col gap-2" v-bind="({ onClickCapture: alClicEnPie } as Record<string, unknown>)">
        <!-- Por qué el botón principal está apagado: una línea bajo los botones. -->
        <p v-if="$slots.ayuda" class="text-sm text-muted text-right">
          <slot name="ayuda" />
        </p>
        <div class="flex w-full flex-row items-center justify-between gap-2">
          <slot name="actions" />
          <slot name="footer" />
        </div>
      </div>
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
  </UDrawer>
</template>
