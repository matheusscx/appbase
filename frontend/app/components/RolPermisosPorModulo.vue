<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'

export interface ModuloDisponible {
  moduloTenantId: string
  moduloAppId: string
  nombre: string
  icono: string | null
  permisos: { moduloAppPermisoId: string, permisoNombre: string }[]
}

const props = defineProps<{
  modulos: ModuloDisponible[]
  seleccionados: Set<string>
  disabled?: boolean
  disabledMessage?: string
  emptyMessage?: string
}>()

const emit = defineEmits<{
  toggle: [id: string, value: boolean | 'indeterminate']
}>()

const busqueda = ref('')

const modulosFiltrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return props.modulos
  return props.modulos.filter(m => m.nombre.toLowerCase().includes(q))
})

function conteoModulo(modulo: ModuloDisponible) {
  const total = modulo.permisos.length
  const sel = modulo.permisos.filter(p => props.seleccionados.has(p.moduloAppPermisoId)).length
  return { sel, total }
}

function moduloPorId(id: string) {
  return props.modulos.find(m => m.moduloTenantId === id)
}

function conteoPorId(id: string) {
  const modulo = moduloPorId(id)
  return modulo ? conteoModulo(modulo) : null
}

function conteoLabel(id: string) {
  const c = conteoPorId(id)
  return c ? `${c.sel}/${c.total}` : ''
}

const accordionItems = computed<AccordionItem[]>(() =>
  modulosFiltrados.value.map(modulo => ({
    label: modulo.nombre,
    icon: modulo.icono ?? undefined,
    value: modulo.moduloTenantId,
  })),
)

watch(() => props.modulos, () => {
  busqueda.value = ''
})
</script>

<template>
  <div
    v-if="disabled"
    class="py-2 text-sm text-muted"
  >
    {{ disabledMessage }}
  </div>

  <div
    v-else-if="!modulos.length"
    class="py-2 text-sm text-muted"
  >
    {{ emptyMessage ?? 'El tenant no tiene módulos contratados.' }}
  </div>

  <div
    v-else
    class="space-y-4"
  >
    <UInput
      v-model="busqueda"
      icon="i-heroicons-magnifying-glass"
      placeholder="Buscar módulo…"
      color="neutral"
      variant="outline"
      :ui="{ root: 'w-full' }"
    />

    <p
      v-if="!accordionItems.length"
      class="py-2 text-sm text-muted"
    >
      Ningún módulo coincide con «{{ busqueda.trim() }}».
    </p>

    <UAccordion
      v-else
      type="multiple"
      :items="accordionItems"
      :unmount-on-hide="false"
      :ui="{
        root: 'divide-y divide-accented rounded-md border border-accented',
        trigger: 'px-4 gap-2',
        body: 'px-4 pb-4',
      }"
    >
      <template #trailing="{ item }">
        <span
          v-if="conteoLabel(String(item.value))"
          class="text-xs tabular-nums text-muted"
        >
          {{ conteoLabel(String(item.value)) }}
        </span>
      </template>

      <template #body="{ item }">
        <div
          v-if="moduloPorId(String(item.value))"
          class="flex flex-col gap-3"
        >
          <UCheckbox
            v-for="permiso in moduloPorId(String(item.value))!.permisos"
            :key="permiso.moduloAppPermisoId"
            :label="permiso.permisoNombre"
            :model-value="seleccionados.has(permiso.moduloAppPermisoId)"
            @update:model-value="(v: boolean | 'indeterminate') => emit('toggle', permiso.moduloAppPermisoId, v)"
          />
        </div>
      </template>
    </UAccordion>
  </div>
</template>
