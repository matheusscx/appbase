<script setup lang="ts">
export interface ModuloDisponible {
  moduloTenantId: string
  moduloAppId: string
  nombre: string
  icono: string | null
  permisos: { moduloAppPermisoId: string, permisoNombre: string }[]
}

defineProps<{
  modulos: ModuloDisponible[]
  seleccionados: Set<string>
  disabled?: boolean
  disabledMessage?: string
  emptyMessage?: string
}>()

const emit = defineEmits<{
  toggle: [id: string, value: boolean | 'indeterminate']
}>()
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
    class="space-y-6"
  >
    <div
      v-for="modulo in modulos"
      :key="modulo.moduloTenantId"
    >
      <div class="mb-2 flex items-center gap-2">
        <UIcon
          v-if="modulo.icono"
          :name="modulo.icono"
          class="h-4 w-4"
        />
        <span class="font-medium text-default">{{ modulo.nombre }}</span>
      </div>
      <div class="flex flex-wrap gap-4 pl-1">
        <UCheckbox
          v-for="permiso in modulo.permisos"
          :key="permiso.moduloAppPermisoId"
          :label="permiso.permisoNombre"
          :model-value="seleccionados.has(permiso.moduloAppPermisoId)"
          @update:model-value="(v: boolean | 'indeterminate') => emit('toggle', permiso.moduloAppPermisoId, v)"
        />
      </div>
    </div>
  </div>
</template>
