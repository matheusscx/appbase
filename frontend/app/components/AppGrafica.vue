<script setup lang="ts">
import { VisAxis, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import { StackedBar } from '@unovis/ts'

/**
 * Barras horizontales apiladas, para cualquier reporte. ADR-027.
 *
 * ⛔ **La gráfica acompaña a la tabla, nunca la reemplaza.** El número vive en la
 * tabla de la pantalla; si Unovis no monta, la pantalla tiene que seguir
 * sirviendo. Por eso va dentro de `<ClientOnly>` y no hay nada que la pantalla
 * lea de acá.
 *
 * ⛔ **Colores por token, no por literal.** Cada serie nombra un color semántico
 * de Nuxt UI y la barra se pinta con `var(--ui-<color>)`: Unovis dibuja SVG, el
 * navegador resuelve la variable y el modo oscuro sale solo. Un `#hex` en el JS
 * no cambiaría con el tema.
 *
 * ⚠️ **Los valores llegan como string y se pasan a `number` solo para el largo de
 * la barra**: es geometría, no plata. El texto que ve la persona lo arma el
 * llamador con `formato` a partir del string original, así que ningún monto se
 * redondea por pasar por un `number`.
 */
type ColorToken = 'error' | 'warning' | 'info' | 'primary' | 'secondary' | 'success' | 'neutral'

export interface SerieGrafica {
  nombre: string
  color: ColorToken
  /** Un valor por categoría, en el mismo orden que `categorias`. */
  valores: string[]
}

const props = withDefaults(
  defineProps<{
    series: SerieGrafica[]
    /** Rótulo de cada barra, en el orden en que se dibujan (de arriba abajo). */
    categorias: string[]
    /** Texto de un valor. Recibe el string original y el índice de la categoría. */
    formato: (valor: string, categoria: number) => string
    /** Rótulo del eje de valores. Sin él, el número a secas. */
    formatoEje?: (valor: number) => string
    cargando?: boolean
    vacio?: boolean
    /** El pedido falló: distinto de `vacio`, que es "no hay nada que mostrar". */
    fallo?: boolean
  }>(),
  { cargando: false, vacio: false, fallo: false, formatoEje: undefined },
)

interface Fila { indice: number, categoria: string, valores: string[] }

const filas = computed<Fila[]>(() =>
  props.categorias.map((categoria, indice) => ({
    indice,
    categoria,
    valores: props.series.map(s => s.valores[indice] ?? '0'),
  })),
)

const colorDe = (token: ColorToken) => `var(--ui-${token})`

// Con orientación horizontal, `x` es la posición de la barra (una por
// categoría) e `y` los largos que se apilan, uno por serie.
// ⚠️ Unovis pone la posición 0 ABAJO: se invierte para que la primera
// categoría —en un top, la más grande— quede arriba. Visto en el navegador:
// sin esto, el que más perdió quedaba al pie.
const posicion = (indice: number) => props.categorias.length - 1 - indice
const x = (d: Fila) => posicion(d.indice)
const y = computed(() => props.series.map((_, s) => (d: Fila) => Number(d.valores[s])))
const color = (_d: unknown, s: number) => colorDe(props.series[s]!.color)

/** Un nombre largo parte en varios renglones y se monta sobre la barra vecina. */
const LARGO_ROTULO = 24
function recortar(texto: string): string {
  return texto.length <= LARGO_ROTULO ? texto : `${texto.slice(0, LARGO_ROTULO - 1).trimEnd()}…`
}

// `posicion` es su propia inversa: la barra dibujada en la posición p es la
// categoría `posicion(p)`.
const rotular = (p: number) => recortar(props.categorias[posicion(p)] ?? '')
const rotularValor = (v: number) => (props.formatoEje ? props.formatoEje(v) : String(v))
const posiciones = computed(() => props.categorias.map((_, i) => i))

/** El tooltip es HTML: los nombres de producto los carga el local, se escapan. */
function escapar(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const triggers = {
  [StackedBar.selectors.bar]: (d: Fila) => {
    const lineas = props.series
      .map((s, i) => `<div>${escapar(s.nombre)}: ${escapar(props.formato(d.valores[i]!, d.indice))}</div>`)
      .join('')
    return `<div><strong>${escapar(d.categoria)}</strong>${lineas}</div>`
  },
}

// Alto por cantidad de barras: con diez productos, una fila de ~32px cada una.
const alto = computed(() => Math.max(160, props.categorias.length * 32 + 40))
</script>

<template>
  <div class="app-grafica space-y-3">
    <div v-if="cargando" data-qa="grafica-cargando" class="space-y-2">
      <USkeleton v-for="i in 5" :key="i" class="h-6 w-full" />
    </div>

    <div v-else-if="fallo" data-qa="grafica-fallo" class="py-8 text-center text-sm text-error">
      No se pudo cargar la gráfica. La tabla de abajo sigue teniendo los números.
    </div>

    <div v-else-if="vacio" data-qa="grafica-vacia" class="py-8 text-center text-sm text-muted">
      Nada que graficar en este rango.
    </div>

    <template v-else>
      <div data-qa="grafica-leyenda" class="flex flex-wrap gap-4 text-xs text-muted">
        <span v-for="s in series" :key="s.nombre" class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: colorDe(s.color) }" />
          {{ s.nombre }}
        </span>
      </div>

      <ClientOnly>
        <VisXYContainer :data="filas" :height="alto">
          <VisStackedBar
            :x="x"
            :y="y"
            :color="color"
            orientation="horizontal"
            :rounded-corners="2"
          />
          <VisAxis type="y" :tick-format="rotular" :tick-values="posiciones" :grid-line="false" />
          <VisAxis type="x" :num-ticks="4" :tick-format="rotularValor" />
          <VisTooltip :triggers="triggers" />
        </VisXYContainer>
      </ClientOnly>
    </template>
  </div>
</template>

<style scoped>
/* Unovis toma tipografía y colores de sus propias variables CSS: se atan a los
   tokens de Nuxt UI para que ejes, grilla y tooltip sigan el tema. */
.app-grafica {
  --vis-font-family: inherit;
  --vis-axis-tick-label-color: var(--ui-text-muted);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-domain-color: var(--ui-border);
  --vis-axis-grid-color: var(--ui-border);
  --vis-tooltip-background-color: var(--ui-bg-elevated);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text);
}
</style>
