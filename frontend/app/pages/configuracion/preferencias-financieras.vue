<script setup lang="ts">
const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const loading = ref(false)
const saving = ref(false)
const calculoDescuentos = ref<'base' | 'compuesto'>('base')
const calculoRecargos = ref<'base' | 'compuesto'>('base')
const formula = ref<string[]>(['descuentos', 'recargos', 'impuestos'])
const escalaCalculo = ref<number>(6)
const modoRedondeo = ref<string>('HALF_UP')
const montoTolerancia = ref<string>('0')

const calculoOptions = [
  { value: 'base', label: 'Sobre monto base', description: 'Todos se calculan sobre el precio neto' },
  { value: 'compuesto', label: 'En cascada (compuesto)', description: 'Cada uno se aplica sobre el resultado del anterior' },
]

const modoRedondeoOptions = [
  { value: 'HALF_UP', label: 'HALF_UP', description: 'Redondea al más cercano; en empate, hacia arriba (más común)', example: '2.345 → 2.35' },
  { value: 'HALF_EVEN', label: 'HALF_EVEN', description: 'Redondea al más cercano; en empate, al par (bancario)', example: '2.345 → 2.34 · 2.355 → 2.36' },
  { value: 'FLOOR', label: 'FLOOR', description: 'Siempre redondea hacia abajo', example: '2.349 → 2.34' },
  { value: 'CEIL', label: 'CEIL', description: 'Siempre redondea hacia arriba', example: '2.341 → 2.35' },
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
      escalaCalculo: number
      modoRedondeo: string
      montoTolerancia: string
    }>(`${apiUrl}/tenants/preferencias-financieras`)
    calculoDescuentos.value = data.calculoDescuentos as 'base' | 'compuesto'
    calculoRecargos.value = data.calculoRecargos as 'base' | 'compuesto'
    formula.value = data.formula
    escalaCalculo.value = data.escalaCalculo
    modoRedondeo.value = data.modoRedondeo
    montoTolerancia.value = data.montoTolerancia
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar preferencias'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
onMounted(cargar)

const formState = computed(() => ({
  calculoDescuentos: calculoDescuentos.value,
  calculoRecargos: calculoRecargos.value,
  formula: formula.value,
  escalaCalculo: escalaCalculo.value,
  modoRedondeo: modoRedondeo.value,
  montoTolerancia: montoTolerancia.value,
}))

async function guardar() {
  saving.value = true
  try {
    await useApiFetch(`${apiUrl}/tenants/preferencias-financieras`, {
      method: 'PUT',
      body: {
        calculoDescuentos: calculoDescuentos.value,
        calculoRecargos: calculoRecargos.value,
        formula: formula.value,
        escalaCalculo: escalaCalculo.value,
        modoRedondeo: modoRedondeo.value,
        montoTolerancia: montoTolerancia.value,
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
  ;[arr[index - 1], arr[index]] = [arr[index]!, arr[index - 1]!]
  formula.value = arr
}
function moverAbajo(index: number) {
  if (index === formula.value.length - 1) return
  const arr = [...formula.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1]!, arr[index]!]
  formula.value = arr
}
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Preferencias financieras"
      description="Configura cómo se calculan descuentos, recargos e impuestos en el motor de precios."
    />

    <div
      v-if="loading"
      class="py-8 text-center text-sm text-muted"
    >
      Cargando...
    </div>

    <UForm v-else :state="formState" class="space-y-6" @submit="guardar">
      <UCard>
        <div class="space-y-6">
          <!-- Cálculo de descuentos -->
          <div class="space-y-2">
            <p class="font-medium text-default">
              Cálculo de descuentos
            </p>
            <p class="text-sm text-muted">
              Define cómo se aplican múltiples descuentos simultáneos.
            </p>
            <URadioGroup
              v-model="calculoDescuentos"
              :items="calculoOptions"
              value-key="value"
            />
          </div>

          <USeparator />

          <!-- Cálculo de recargos -->
          <div class="space-y-2">
            <p class="font-medium text-default">
              Cálculo de recargos
            </p>
            <p class="text-sm text-muted">
              Define cómo se aplican múltiples recargos simultáneos.
            </p>
            <URadioGroup
              v-model="calculoRecargos"
              :items="calculoOptions"
              value-key="value"
            />
          </div>

          <USeparator />

          <!-- Precisión y redondeo -->
          <div class="space-y-4">
            <p class="font-medium text-default">
              Precisión y redondeo
            </p>
            <p class="text-sm text-muted">
              Controla la precisión de los cálculos intermedios y cómo se redondean los resultados.
            </p>

            <UFormField label="Escala de cálculo" hint="Decimales usados en cálculos internos (0–12)">
              <UInput
                v-model.number="escalaCalculo"
                type="number"
                :min="0"
                :max="12"
                class="w-32"
              />
            </UFormField>

            <UFormField label="Modo de redondeo">
              <URadioGroup
                v-model="modoRedondeo"
                :items="modoRedondeoOptions"
                value-key="value"
              >
                <template #description="{ item }">
                  {{ item.description }}
                  <span class="block font-mono text-xs mt-0.5 opacity-60">Ej: {{ item.example }}</span>
                </template>
              </URadioGroup>
            </UFormField>

            <UFormField label="Tolerancia de conciliación" hint="Diferencia máxima permitida antes de rechazar una conciliación">
              <UInput
                v-model="montoTolerancia"
                inputmode="decimal"
                placeholder="0"
                class="w-40"
              />
            </UFormField>
          </div>

          <USeparator />

          <!-- Orden de la fórmula -->
          <div class="space-y-3">
            <p class="font-medium text-default">
              Orden de la fórmula de precios
            </p>
            <p class="text-sm text-muted">
              Define el orden en que se aplican los pasos al calcular el precio final.
            </p>

            <div class="space-y-1">
              <!-- Precio neto (fijo) -->
              <div class="flex items-center gap-3 px-3 py-2 rounded-md bg-elevated opacity-50">
                <span class="flex-1 text-sm font-medium text-muted">
                  Precio neto
                </span>
                <span class="text-xs text-muted">
                  (fijo — siempre primero)
                </span>
              </div>

              <!-- Pasos reordenables -->
              <div
                v-for="(paso, i) in formula"
                :key="paso"
                class="flex items-center gap-3 px-3 py-2 rounded-md border border-default"
              >
                <span class="flex-1 text-sm font-medium">
                  {{ pasoLabels[paso] ?? paso }}
                </span>
                <div class="flex gap-1">
                  <UButton
                    icon="i-lucide-chevron-up"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    :disabled="i === 0"
                    @click="moverArriba(i)"
                  />
                  <UButton
                    icon="i-lucide-chevron-down"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    :disabled="i === formula.length - 1"
                    @click="moverAbajo(i)"
                  />
                </div>
              </div>

              <!-- Total final (fijo) -->
              <div class="flex items-center gap-3 px-3 py-2 rounded-md bg-elevated opacity-50">
                <span class="flex-1 text-sm font-medium text-muted">
                  Total final
                </span>
                <span class="text-xs text-muted">
                  (fijo — siempre último)
                </span>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <div class="flex justify-end">
        <UButton
          type="submit"
          :loading="saving"
        >
          Guardar
        </UButton>
      </div>
    </UForm>
  </div>
</template>
