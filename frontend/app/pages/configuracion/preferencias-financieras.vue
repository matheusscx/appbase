<script setup lang="ts">
const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const loading = ref(false)
const saving = ref(false)
const calculoDescuentos = ref<'base' | 'compuesto'>('base')
const calculoRecargos = ref<'base' | 'compuesto'>('base')
const formula = ref<string[]>(['descuentos', 'recargos', 'impuestos'])

const calculoOptions = [
  { value: 'base', label: 'Sobre monto base', description: 'Todos se calculan sobre el precio neto' },
  { value: 'compuesto', label: 'En cascada (compuesto)', description: 'Cada uno se aplica sobre el resultado del anterior' },
]

const pasoLabels: Record<string, string> = {
  descuentos: 'Descuentos',
  recargos: 'Recargos',
  impuestos: 'Impuestos',
}

async function cargar() {
  loading.value = true
  try {
    const data = await useApiFetch<{
      calculoDescuentos: string
      calculoRecargos: string
      formula: string[]
    }>(`${apiUrl}/tenants/preferencias-financieras`)
    calculoDescuentos.value = data.calculoDescuentos as 'base' | 'compuesto'
    calculoRecargos.value = data.calculoRecargos as 'base' | 'compuesto'
    formula.value = data.formula
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar preferencias'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
onMounted(cargar)

async function guardar() {
  saving.value = true
  try {
    await useApiFetch(`${apiUrl}/tenants/preferencias-financieras`, {
      method: 'PUT',
      body: {
        calculoDescuentos: calculoDescuentos.value,
        calculoRecargos: calculoRecargos.value,
        formula: formula.value,
      },
    })
    toast.add({ title: 'Preferencias actualizadas', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

function moverArriba(index: number) {
  if (index === 0) return
  const arr = [...formula.value]
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
  formula.value = arr
}
function moverAbajo(index: number) {
  if (index === formula.value.length - 1) return
  const arr = [...formula.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
  formula.value = arr
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold">
        Preferencias financieras
      </h2>
      <p class="text-sm text-gray-500">
        Configura cómo se calculan descuentos, recargos e impuestos en el motor de precios.
      </p>
    </div>

    <div
      v-if="loading"
      class="py-8 text-center text-sm text-gray-500"
    >
      Cargando...
    </div>

    <template v-else>
      <UCard>
        <div class="space-y-6">
          <!-- Cálculo de descuentos -->
          <div class="space-y-2">
            <p class="font-medium">
              Cálculo de descuentos
            </p>
            <p class="text-sm text-gray-500">
              Define cómo se aplican múltiples descuentos simultáneos.
            </p>
            <URadioGroup
              v-model="calculoDescuentos"
              :items="calculoOptions"
              value-key="value"
            />
          </div>

          <UDivider />

          <!-- Cálculo de recargos -->
          <div class="space-y-2">
            <p class="font-medium">
              Cálculo de recargos
            </p>
            <p class="text-sm text-gray-500">
              Define cómo se aplican múltiples recargos simultáneos.
            </p>
            <URadioGroup
              v-model="calculoRecargos"
              :items="calculoOptions"
              value-key="value"
            />
          </div>

          <UDivider />

          <!-- Orden de la fórmula -->
          <div class="space-y-3">
            <p class="font-medium">
              Orden de la fórmula de precios
            </p>
            <p class="text-sm text-gray-500">
              Define el orden en que se aplican los pasos al calcular el precio final.
            </p>

            <div class="space-y-1">
              <!-- Precio neto (fijo) -->
              <div class="flex items-center gap-3 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 opacity-50">
                <span class="flex-1 text-sm font-medium text-gray-500">
                  Precio neto
                </span>
                <span class="text-xs text-gray-400">
                  (fijo — siempre primero)
                </span>
              </div>

              <!-- Pasos reordenables -->
              <div
                v-for="(paso, i) in formula"
                :key="paso"
                class="flex items-center gap-3 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700"
              >
                <span class="flex-1 text-sm font-medium">
                  {{ pasoLabels[paso] ?? paso }}
                </span>
                <div class="flex gap-1">
                  <UButton
                    icon="i-heroicons-chevron-up"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    :disabled="i === 0"
                    @click="moverArriba(i)"
                  />
                  <UButton
                    icon="i-heroicons-chevron-down"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    :disabled="i === formula.length - 1"
                    @click="moverAbajo(i)"
                  />
                </div>
              </div>

              <!-- Total final (fijo) -->
              <div class="flex items-center gap-3 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 opacity-50">
                <span class="flex-1 text-sm font-medium text-gray-500">
                  Total final
                </span>
                <span class="text-xs text-gray-400">
                  (fijo — siempre último)
                </span>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <div class="flex justify-end">
        <UButton
          :loading="saving"
          @click="guardar"
        >
          Guardar
        </UButton>
      </div>
    </template>
  </div>
</template>
