<script setup lang="ts">
// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

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
const nivelRedondeo = ref<string>('linea')
const montoTolerancia = ref<string>('0')
// Umbrales de descuadre al cierre de caja. `'0'` DESACTIVA el nivel — es lo
// contrario de la tolerancia de arriba, donde `0` significa "cero tolerancia".
const umbralDescuadreAviso = ref<string>('0')
const umbralDescuadreAlto = ref<string>('0')
const promosAcumulanDescuentos = ref<boolean>(false)

// El candado que pone el país. Lo manda el backend junto con la config: la
// pantalla no lo deduce, porque la regla vive en la tabla `pais` y cambia por
// país. `norma` es el motivo que se le muestra al tenant — un candado sin
// explicación se lee como un bug del sistema, no como una regla del país.
const modoRedondeoBloqueado = ref(false)
const modoRedondeoNorma = ref<string | null>(null)
const nivelRedondeoBloqueado = ref(false)
const nivelRedondeoNorma = ref<string | null>(null)
// Lo guardado ≠ lo que impone la norma. Solo pasa con un tenant creado antes de
// que la regla existiera, y hay que decirlo: hasta que alguien guarde, el motor
// de precios sigue calculando con el valor viejo.
const modoRedondeoDesalineado = ref(false)
const nivelRedondeoDesalineado = ref(false)
// El nivel 'documento' arrastra la escala: ver el comentario en `cargar()`.
const escalaBajadaPorElNivel = ref(false)

const calculoOptions = [
  { value: 'base', label: 'Sobre monto base', description: 'Todos se calculan sobre el precio neto' },
  { value: 'compuesto', label: 'En cascada (compuesto)', description: 'Cada uno se aplica sobre el resultado del anterior' },
]

const promosAcumulanOptions = [
  { value: true, label: 'Se suman', description: 'El cliente recibe la promoción y el descuento juntos.' },
  { value: false, label: 'Aplica solo la rebaja mayor', description: 'Entre la promoción y el descuento, se aplica el que rebaja más.' },
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

const nivelRedondeoOptions = [
  { value: 'linea', label: 'Por línea', description: 'Cada línea de la venta se redondea por separado y el total es la suma de esos redondeos. Es lo habitual: cada línea del comprobante muestra un monto que la moneda puede representar, y suman exacto.' },
  { value: 'documento', label: 'Por documento', description: 'Las líneas se calculan con toda su precisión y solo el total final se redondea a la moneda. Elegilo si tu normativa exige que el redondeo ocurra en el total y no en cada línea (es la regla mexicana); a cambio, las líneas del comprobante pueden mostrar decimales que la moneda no tiene.' },
]

async function cargar() {
  loading.value = true
  try {
    const data = await useApiFetch<{
      calculoDescuentos: string
      calculoRecargos: string
      formula: string[]
      escalaCalculo: number
      modoRedondeo: string
      nivelRedondeo: string
      montoTolerancia: string
      umbralDescuadreAviso: string
      umbralDescuadreAlto: string
      promosAcumulanDescuentos: boolean
      modoRedondeoBloqueado: boolean
      modoRedondeoImpuesto: string | null
      modoRedondeoNorma: string | null
      nivelRedondeoBloqueado: boolean
      nivelRedondeoImpuesto: string | null
      nivelRedondeoNorma: string | null
    }>(`${apiUrl}/tenants/preferencias-financieras`)
    calculoDescuentos.value = data.calculoDescuentos as 'base' | 'compuesto'
    calculoRecargos.value = data.calculoRecargos as 'base' | 'compuesto'
    formula.value = data.formula
    escalaCalculo.value = data.escalaCalculo
    modoRedondeoBloqueado.value = data.modoRedondeoBloqueado
    modoRedondeoNorma.value = data.modoRedondeoNorma
    nivelRedondeoBloqueado.value = data.nivelRedondeoBloqueado
    nivelRedondeoNorma.value = data.nivelRedondeoNorma
    // Con la perilla cerrada mostramos el valor que impone la norma, no el
    // guardado. No suelen diferir —el tenant nace con el de su país— pero uno
    // creado antes de que la regla existiera tiene persistido otro: si la
    // pantalla le mostrara ese, el backend le rebotaría con 400 TODOS sus
    // guardados, incluidos los de las demás preferencias, y sin salida por acá.
    //
    // Y cuando difieren se dice, porque el motor de precios sigue calculando
    // con el valor viejo hasta que alguien guarde: sin la frase, la pantalla
    // afirmaría en presente algo que todavía no es cierto.
    modoRedondeo.value = data.modoRedondeoBloqueado
      ? (data.modoRedondeoImpuesto ?? data.modoRedondeo)
      : data.modoRedondeo
    nivelRedondeo.value = data.nivelRedondeoBloqueado
      ? (data.nivelRedondeoImpuesto ?? data.nivelRedondeo)
      : data.nivelRedondeo
    modoRedondeoDesalineado.value
      = data.modoRedondeoBloqueado && data.modoRedondeo !== modoRedondeo.value
    nivelRedondeoDesalineado.value
      = data.nivelRedondeoBloqueado && data.nivelRedondeo !== nivelRedondeo.value
    // 'documento' no admite una escala mayor que 4 y el backend lo rechaza con
    // 400. Un tenant legado nació con escala 6 y nivel 'linea': si le pisamos
    // solo el nivel, el guardado que la norma le OBLIGA a hacer es imposible —
    // y la salida que sugiere el mensaje del backend, «usá linea», es justo el
    // radio que acabamos de deshabilitar. Es la misma regla que aplica
    // `TenantsService.create` al nacer el tenant, acá para el que nació antes.
    //
    // ⚠️ Pide `Bloqueado`, y no solo que el nivel sea 'documento': sin candado
    // el admin SÍ tiene salida —volver a «Por línea», que ahí es un radio
    // habilitado— y bajarle la escala en silencio sería tomarle una decisión
    // que él puede tomar. Con candado no hay tal salida y hay que sacarlo del
    // pozo; sin candado, se le deja.
    escalaBajadaPorElNivel.value
      = data.nivelRedondeoBloqueado
        && nivelRedondeo.value === 'documento'
        && escalaCalculo.value > 4
    if (escalaBajadaPorElNivel.value) escalaCalculo.value = 4
    montoTolerancia.value = data.montoTolerancia
    umbralDescuadreAviso.value = data.umbralDescuadreAviso
    umbralDescuadreAlto.value = data.umbralDescuadreAlto
    promosAcumulanDescuentos.value = data.promosAcumulanDescuentos
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar preferencias'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
onMounted(cargar)

/**
 * El texto que acompaña a una perilla cerrada. La norma va siempre que exista:
 * es lo único que distingue una regla del país de un bug del sistema.
 *
 * ⚠️ Un candado SIN norma no es un estado que el backend deba producir —el
 * `@Check` de `pais` exige el valor y el `GET` gatea la norma por `es_ley`— y
 * si llegara, la frase sola no rescata a nadie: ese tenant tampoco puede
 * guardar por API. Es display honesto, no una red.
 */
function motivoDelCandado(
  norma: string | null,
  desalineado: boolean,
  escalaBajada = false,
): string {
  return [
    'Lo fija la norma de tu país: no se puede cambiar.',
    desalineado
      ? 'Tu configuración guardada todavía tiene otro valor y el cálculo lo '
        + 'sigue usando: se corrige cuando guardes.'
      : null,
    // Independiente del desalineado: la escala puede bajar aunque el nivel
    // guardado ya sea el que impone la norma (un legado con 'documento' y
    // escala 6 existe — la validación de la escala llegó después que el nivel).
    // Cambiarle un número al admin sin decírselo no es opción en ninguno.
    escalaBajada
      ? 'También bajamos la escala de cálculo a 4, que es el máximo que este '
        + 'nivel admite.'
      : null,
    norma,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Con el nivel "Por documento" el backend rechaza toda escala mayor que 4
 * (`updatePreferenciasFinancieras`): las líneas se persisten sin cuantizar y
 * las columnas de plata son NUMERIC(18,4). El input no lo deja tipear, mismo
 * criterio que `MoneyInput oficial` con los decimales de la moneda.
 */
const escalaMaxima = computed(() => (nivelRedondeo.value === 'documento' ? 4 : 12))

const formState = computed(() => ({
  calculoDescuentos: calculoDescuentos.value,
  calculoRecargos: calculoRecargos.value,
  formula: formula.value,
  escalaCalculo: escalaCalculo.value,
  modoRedondeo: modoRedondeo.value,
  nivelRedondeo: nivelRedondeo.value,
  montoTolerancia: montoTolerancia.value,
  umbralDescuadreAviso: umbralDescuadreAviso.value,
  umbralDescuadreAlto: umbralDescuadreAlto.value,
  promosAcumulanDescuentos: promosAcumulanDescuentos.value,
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
        nivelRedondeo: nivelRedondeo.value,
        montoTolerancia: montoTolerancia.value,
        umbralDescuadreAviso: umbralDescuadreAviso.value,
        umbralDescuadreAlto: umbralDescuadreAlto.value,
        promosAcumulanDescuentos: promosAcumulanDescuentos.value,
      },
    })
    // El admin puede acabar de cambiar `modoRedondeo`: sin esto, `useMonedaConversion`
    // (usada en catálogo/carrito para la vista previa "≈ $X c/u") seguiría mostrando
    // el modo viejo cacheado por el resto de la sesión SPA.
    resetModoRedondeoTenant()
    // Lo que está guardado ES lo que se muestra: el aviso de "tu configuración
    // todavía tiene otro valor" pasó a ser falso en este mismo instante, y
    // dejarlo puesto debajo del toast de éxito es el mismo bug al revés.
    modoRedondeoDesalineado.value = false
    nivelRedondeoDesalineado.value = false
    escalaBajadaPorElNivel.value = false
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

          <!-- Promociones vs. descuentos -->
          <div class="space-y-2">
            <p class="font-medium text-default">
              Promociones y descuentos
            </p>
            <p class="text-sm text-muted">
              Cuando una promoción y un descuento tocan el mismo producto: ¿se suman, o
              aplica solo la rebaja mayor?
            </p>
            <URadioGroup
              v-model="promosAcumulanDescuentos"
              :items="promosAcumulanOptions"
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

            <!--
              El tope no es fijo: con el nivel "Por documento" las líneas se
              persisten sin cuantizar en columnas NUMERIC(18,4) y el backend
              rechaza con 400 toda escala mayor que 4. Dejarlo tipear 12 y
              enterarse al guardar es el mismo bug que este frente vino a
              cerrar en las perillas de al lado — y con el nivel trabado por
              ley, la salida que sugiere ese 400 ("usá linea") ni siquiera
              existe.
            -->
            <UFormField
              label="Escala de cálculo"
              :hint="`Decimales usados en cálculos internos (0–${escalaMaxima})`"
            >
              <UInput
                v-model.number="escalaCalculo"
                type="number"
                :min="0"
                :max="escalaMaxima"
                class="w-32"
              />
            </UFormField>

            <UFormField
              label="Modo de redondeo"
              :description="modoRedondeoBloqueado ? motivoDelCandado(modoRedondeoNorma, modoRedondeoDesalineado) : undefined"
            >
              <URadioGroup
                v-model="modoRedondeo"
                :items="modoRedondeoOptions"
                value-key="value"
                :disabled="modoRedondeoBloqueado"
              >
                <template #description="{ item }">
                  {{ item.description }}
                  <span class="block font-mono text-xs mt-0.5 opacity-60">Ej: {{ item.example }}</span>
                </template>
              </URadioGroup>
            </UFormField>

            <UFormField
              label="Nivel de redondeo"
              hint="Cuándo se ajustan los centavos: en cada línea de la venta, o solo una vez al final del documento. Si no te lo exige una normativa, dejá «Por línea»."
              :description="nivelRedondeoBloqueado ? motivoDelCandado(nivelRedondeoNorma, nivelRedondeoDesalineado, escalaBajadaPorElNivel) : undefined"
            >
              <URadioGroup
                v-model="nivelRedondeo"
                :items="nivelRedondeoOptions"
                value-key="value"
                :disabled="nivelRedondeoBloqueado"
              >
                <template #description="{ item }">
                  {{ item.description }}
                </template>
              </URadioGroup>
            </UFormField>

            <UFormField label="Tolerancia de conciliación" hint="Diferencia máxima permitida antes de rechazar una conciliación">
              <!--
                Es un monto COBRADO en la moneda oficial del tenant: el backend le
                colgó `@EsMontoCobrado()` y el pipe rechaza con 400 lo que no cabe
                en esa escala (un `1,5` en pesos chilenos, por ejemplo). `UInput`
                dejaba tipearlo igual y el error llegaba recién al guardar.
              -->
              <MoneyInput
                v-model="montoTolerancia"
                oficial
                class="w-40"
              />
            </UFormField>
          </div>

          <USeparator />

          <!-- Umbrales de descuadre al cierre de caja -->
          <div class="space-y-4">
            <div class="space-y-1">
              <p class="font-medium text-default">
                Diferencias al cerrar caja
              </p>
              <p class="text-sm text-muted">
                Cuánto puede descuadrar un turno antes de que el sistema diga algo.
                <strong>Ninguno de los dos frena el cierre</strong>: el cajero cierra y se
                va igual. El número se mide sobre la diferencia de cada medio de pago por
                separado, no sobre el total — así un faltante de efectivo tapado por un
                sobrante de tarjeta no pasa desapercibido.
              </p>
              <p class="text-sm text-muted">
                Dejá un umbral en <strong>0</strong> para apagarlo. Para elegir los
                números, mirá primero la
                <ULink to="/cajas/tendencia" class="text-highlighted">
                  tendencia de descuadres
                </ULink>: sirve saber cuánto descuadra tu local de verdad.
              </p>
            </div>

            <UFormField
              label="Avisar al cajero desde"
              hint="Ve una advertencia al cerrar y puede dejar una nota. Nadie más se entera."
            >
              <MoneyInput
                v-model="umbralDescuadreAviso"
                oficial
                class="w-40"
                data-qa="umbral-descuadre-aviso"
              />
            </UFormField>

            <UFormField
              label="Avisar al encargado desde"
              hint="Además del aviso al cajero, el cierre le queda al encargado en «Pendientes de revisar» hasta que alguien lo marque visto. No puede ser menor que el de arriba."
            >
              <MoneyInput
                v-model="umbralDescuadreAlto"
                oficial
                class="w-40"
                data-qa="umbral-descuadre-alto"
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
