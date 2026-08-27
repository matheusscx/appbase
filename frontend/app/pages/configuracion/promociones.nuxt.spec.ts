// @vitest-environment nuxt
//
// Molde: `descuentos.nuxt.spec.ts` (setup de mount/mocks). Sin Docker/stack en
// este worktree, este spec es HOY la única red de runtime del drawer — el
// smoke de navegador está diferido. Fija lo que el build/typecheck no ven:
//   1. La lista renderiza y el badge de vigencia distingue Programada / Vigente
//      (sin badge) / Vencida / Pausada — `estadoPromocionBadge` real, sin mock.
//   2. El botón "Nueva promoción" abre el drawer.
//   3. El drawer muestra los campos correctos por `tipo` (porcentaje/nxm/
//      precio_fijo) — el `v-if` que lee `PROMOCION_CONFIG`.
//   4. "Agregar componente" arma un slot nuevo del combo.
//   5. El submit arma el body exacto que `PromocionesService` espera —
//      inclu­ida la key `scopes`, que es la parte que un typo de nombre de
//      campo no cazaría ni en build ni en typecheck (el `body` viaja como
//      `Record<string, unknown>` hacia `useApiFetch`).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Promociones from './promociones.vue'

interface ScopeFake {
  id: string
  slot: number
  tipoScope: string
  categoriaId: string | null
  cantidad: number
  itemIds: string[]
}

interface PromoFake {
  id: string
  nombre: string
  descripcion: string | null
  activo: boolean
  fechaInicio: string
  fechaFin: string
  horaInicio: string | null
  horaFin: string | null
  diasSemana: number[] | null
  canal: string | null
  tipo: 'porcentaje' | 'nxm' | 'precio_fijo'
  valorPorcentaje: string | null
  cadaN: number | null
  valorMonto: string | null
  scopes: ScopeFake[]
}

function promo(over: Partial<PromoFake> = {}): PromoFake {
  return {
    id: 'promo-1',
    nombre: 'Happy hour',
    descripcion: null,
    activo: true,
    fechaInicio: '2020-01-01',
    fechaFin: '2099-01-01',
    horaInicio: null,
    horaFin: null,
    diasSemana: null,
    canal: null,
    tipo: 'porcentaje',
    valorPorcentaje: '0.20',
    cadaN: null,
    valorMonto: null,
    scopes: [{ id: 'scope-1', slot: 0, tipoScope: 'venta', categoriaId: null, cantidad: 1, itemIds: [] }],
    ...over,
  }
}

function promoDefaults(): PromoFake {
  return promo({ scopes: [] })
}

function scopesFromBody(raw: unknown): ScopeFake[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s: Record<string, unknown>, i: number) => ({
    id: `scope-nueva-${i}`,
    slot: i,
    tipoScope: s.tipoScope as string,
    categoriaId: (s.categoriaId as string | null) ?? null,
    cantidad: (s.cantidad as number) ?? 1,
    itemIds: (s.itemIds as string[]) ?? [],
  }))
}

// Estado del "backend" simulado.
let promocionesBackend: PromoFake[] = []
const categoriasBackend = [{ id: 'cat-1', nombre: 'Bebidas', activo: true }]
const itemsBackend = [
  { id: 'item-1', nombre: 'Item Uno', categoriaNombre: 'Bebidas' },
  { id: 'item-2', nombre: 'Item Dos', categoriaNombre: null },
]

/** Cada `POST /promociones` recibido, con el body entero — es donde se ve si
 *  la key `scopes` viaja con la forma exacta que el service espera. */
let postsPromocion: Record<string, unknown>[] = []
/**
 * Rechaza el `POST` DESPUÉS de registrarlo en `postsPromocion` — mismo truco
 * que `patchGuardarFalla` en `descuentos.nuxt.spec.ts`: un guardado exitoso
 * pone `drawerOpen.value = false`, que dispara la transición de salida de
 * `usePresence` (reka-ui) y en happy-dom eso es un *unhandled rejection* que
 * deja `vitest run` en exit 1 aunque todos los tests pasen (medido y
 * documentado en `docs/patterns/frontend.md` §15, "Spec de PÁGINA que CIERRA
 * un drawer"). El test del body no necesita que el drawer cierre — solo que
 * el POST haya salido con la forma correcta.
 */
let postPromocionFalla = false

mockNuxtImport('useApiFetch', () => {
  return (
    url: string,
    opts?: { method?: string, body?: Record<string, unknown> },
  ) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/categorias')) return Promise.resolve(categoriasBackend)
    if (url.includes('/items')) {
      return Promise.resolve({
        data: itemsBackend,
        meta: { page: 1, pageSize: 100, total: itemsBackend.length, totalPages: 1 },
      })
    }
    if (url.includes('/promociones')) {
      const method = opts?.method ?? 'GET'
      if (method === 'POST') {
        const body = opts?.body ?? {}
        postsPromocion.push(body)
        if (postPromocionFalla) {
          return Promise.reject(new Error('rechazo deliberado — no cerrar el drawer en el test'))
        }
        const saved: PromoFake = {
          ...promoDefaults(),
          ...(body as Partial<PromoFake>),
          id: 'promo-nueva',
          scopes: scopesFromBody(body.scopes),
        }
        return Promise.resolve(saved)
      }
      if (method === 'PATCH') {
        const id = url.split('/').pop()
        const p = promocionesBackend.find(x => x.id === id)
        if (p) Object.assign(p, opts?.body ?? {})
        return Promise.resolve({ ...p })
      }
      if (method === 'DELETE') return Promise.resolve(undefined)
      return Promise.resolve(promocionesBackend.map(p => ({ ...p })))
    }
    return Promise.resolve([])
  }
})

function reset() {
  postsPromocion = []
  postPromocionFalla = false
  // `UDrawer` (dentro de `AppDrawer`) teletransporta su contenido al `body` y
  // desmontar el wrapper NO lo saca de ahí — mismo hallazgo que
  // `descuentos.nuxt.spec.ts` documenta en su describe del nivel. Sin esta
  // limpieza, `dialogo()` (que devuelve el PRIMERO que encuentra) puede
  // entregar el drawer de un test anterior y contaminar tanto las
  // aserciones de texto como `selectsMenu()` (que entonces cuenta también
  // los `USelectMenu` del drawer viejo). Medido: sin esto, un mutante en
  // `promociones-form-config.ts` hacía fallar tests que no tenían nada que
  // ver con el campo mutado — la firma exacta de contaminación entre tests.
  document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
}

async function montar() {
  const wrapper = await mountSuspended(Promociones)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

/** Los badges de vigencia/pausa de la tabla, como elementos y no como
 *  subcadena del texto de la página — mismo criterio que `badgesVigencia()`
 *  en `descuentos.nuxt.spec.ts`. */
function badges(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody span')
    .map(s => s.text().trim())
    .filter(t => ['Pausada', 'Programada', 'Vencida'].includes(t))
}

async function abrirCrear(wrapper: Awaited<ReturnType<typeof montar>>) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Nueva promoción'))
  expect(boton, 'botón "Nueva promoción"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

/** Todos los `USelectMenu` del árbol de componentes, en el mismo orden del
 *  template — `findComponent(All)` de VTU sigue el árbol de instancias, no el
 *  DOM, así que encuentra los teletransportados por `UDrawer` igual que
 *  `descuentos.nuxt.spec.ts` encuentra el suyo dentro de `UModal`. `[0]` es
 *  SIEMPRE el de "Tipo": es el primer `USelectMenu` que el template declara,
 *  para cualquier `tipo` y cualquier cantidad de scopes. */
function selectsMenu(wrapper: Awaited<ReturnType<typeof montar>>) {
  return wrapper.findAllComponents({ name: 'USelectMenu' })
}

async function elegirTipo(wrapper: Awaited<ReturnType<typeof montar>>, tipo: string) {
  const selects = selectsMenu(wrapper)
  expect(selects.length, 'USelectMenu de Tipo').toBeGreaterThan(0)
  selects[0]!.vm.$emit('update:modelValue', tipo)
  await new Promise(r => setTimeout(r, 20))
}

/** El multi-select de Ítems del único scope: con `tipo` recién elegido en
 *  'porcentaje'/'nxm' (un solo scope, `tipoScope` default 'items') es el
 *  TERCER `USelectMenu` — [0] Tipo, [1] Condición del scope, [2] Ítems. */
async function elegirItems(wrapper: Awaited<ReturnType<typeof montar>>, ids: string[]) {
  const selects = selectsMenu(wrapper)
  expect(selects.length, 'USelectMenu de Ítems').toBeGreaterThanOrEqual(3)
  selects[2]!.vm.$emit('update:modelValue', ids)
  await new Promise(r => setTimeout(r, 20))
}

/** `AppDateInput`/`AppTimeInput` exponen `qa-set-value` (evento custom sobre
 *  el nodo con `data-qa`) para setearse sin manejar el calendario real — el
 *  mismo contrato que usa `scripts/qa/date-time-inputs-e2e.sh`. */
async function setFecha(qa: string, valor: string) {
  const el = dialogo()?.querySelector(`[data-qa="${qa}"]`)
  expect(el, `campo data-qa="${qa}"`).toBeTruthy()
  el!.dispatchEvent(new CustomEvent('qa-set-value', { detail: valor }))
  await new Promise(r => setTimeout(r, 20))
}

function botonPorTexto(texto: string): HTMLElement | undefined {
  return [...(dialogo()?.querySelectorAll<HTMLElement>('button') ?? [])]
    .find(b => b.textContent?.trim() === texto)
}

async function clickBoton(texto: string) {
  const boton = botonPorTexto(texto)
  expect(boton, `botón "${texto}" del drawer`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 60))
}

describe('configuracion/promociones — lista con badges de vigencia', () => {
  beforeEach(() => {
    reset()
  })

  it('vigente no lleva badge; pausada/programada/vencida sí, cada una la suya', async () => {
    promocionesBackend = [
      promo({ id: 'p-vigente', nombre: 'Happy hour', fechaInicio: '2020-01-01', fechaFin: '2099-01-01', activo: true }),
      promo({ id: 'p-pausada', nombre: 'Pausada de prueba', fechaInicio: '2020-01-01', fechaFin: '2099-01-01', activo: false }),
      promo({ id: 'p-programada', nombre: 'A futuro', fechaInicio: '2099-01-01', fechaFin: '2099-06-01', activo: true }),
      promo({ id: 'p-vencida', nombre: 'Vieja', fechaInicio: '2020-01-01', fechaFin: '2020-06-01', activo: true }),
    ]
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Happy hour')
    expect(wrapper.text()).toContain('Pausada de prueba')
    expect(wrapper.text()).toContain('A futuro')
    expect(wrapper.text()).toContain('Vieja')

    const vistos = badges(wrapper)
    expect(vistos).toContain('Pausada')
    expect(vistos).toContain('Programada')
    expect(vistos).toContain('Vencida')
    // La vigente no aporta ninguno de los tres: solo se marca la excepción.
    expect(vistos.filter(b => b === 'Pausada')).toHaveLength(1)
    expect(vistos.filter(b => b === 'Programada')).toHaveLength(1)
    expect(vistos.filter(b => b === 'Vencida')).toHaveLength(1)

    wrapper.unmount()
  })

  // `activo` gana sobre las fechas SIEMPRE — el eje que `usePromociones.ts`
  // fija en unit y que acá se ve de verdad con una fila real: una promo
  // pausada, aunque sus fechas la harían vigente, se marca `Pausada`, no se
  // queda sin badge.
  it('pausada gana sobre vigente: una promo vigente por fecha pero pausada se marca Pausada', async () => {
    promocionesBackend = [
      promo({ nombre: 'Vigente pero pausada', fechaInicio: '2020-01-01', fechaFin: '2099-01-01', activo: false }),
    ]
    const wrapper = await montar()

    expect(badges(wrapper)).toEqual(['Pausada'])

    wrapper.unmount()
  })
})

describe('configuracion/promociones — abrir el drawer en crear', () => {
  beforeEach(() => {
    reset()
    promocionesBackend = []
  })

  it('el botón "Nueva promoción" abre el drawer vacío', async () => {
    const wrapper = await montar()

    expect(dialogo()).toBeNull()
    await abrirCrear(wrapper)

    expect(dialogo()?.textContent).toContain('Nueva promoción')

    wrapper.unmount()
  })
})

describe('configuracion/promociones — el formulario cambia campos según el tipo', () => {
  beforeEach(() => {
    reset()
    promocionesBackend = []
  })

  it('porcentaje pide el % y "Aplica a" un único scope, sin agregar componentes', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await elegirTipo(wrapper, 'porcentaje')

    const texto = dialogo()?.textContent ?? ''
    expect(texto).toContain('Porcentaje de descuento')
    expect(texto).not.toContain('Cada cuántas unidades')
    expect(texto).not.toContain('Precio del combo')
    expect(texto).toContain('Aplica a')
    expect(texto).not.toContain('Agregar componente')

    wrapper.unmount()
  })

  it('nxm pide cadaN + el %', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await elegirTipo(wrapper, 'nxm')

    const texto = dialogo()?.textContent ?? ''
    expect(texto).toContain('Porcentaje sobre la unidad más barata del grupo')
    expect(texto).toContain('Cada cuántas unidades')
    expect(texto).not.toContain('Precio del combo')
    expect(texto).not.toContain('Agregar componente')

    wrapper.unmount()
  })

  it('precio_fijo pide el monto y arma slots: aparece "Componentes del combo"', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await elegirTipo(wrapper, 'precio_fijo')

    const texto = dialogo()?.textContent ?? ''
    expect(texto).toContain('Precio del combo')
    expect(texto).not.toContain('Porcentaje de descuento')
    expect(texto).not.toContain('Cada cuántas unidades')
    expect(texto).toContain('Componentes del combo')
    expect(texto).toContain('Agregar componente')
    expect(texto).toContain('Componente 1')

    wrapper.unmount()
  })
})

describe('configuracion/promociones — armar slots del combo (precio_fijo)', () => {
  beforeEach(() => {
    reset()
    promocionesBackend = []
  })

  it('"Agregar componente" suma un slot nuevo, sin pisar el primero', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await elegirTipo(wrapper, 'precio_fijo')

    expect(dialogo()?.textContent).toContain('Componente 1')
    expect(dialogo()?.textContent).not.toContain('Componente 2')

    await clickBoton('Agregar componente')

    expect(dialogo()?.textContent).toContain('Componente 1')
    expect(dialogo()?.textContent).toContain('Componente 2')

    wrapper.unmount()
  })
})

/**
 * El caso completo: una promo `porcentaje` con un scope de ítems. Fija el
 * `body` exacto que sale del formulario — incluida la key `scopes`, que es
 * lo que un `PromocionesService.validarScopes` real rechazaría si viniera con
 * otra forma (`itemIds` faltante, `categoriaId` colgando de un scope que no
 * es 'categoria', etc.). Ni el build ni el typecheck ven esto: `body` viaja
 * como objeto plano hacia `useApiFetch`.
 */
describe('configuracion/promociones — el submit arma el payload correcto', () => {
  beforeEach(() => {
    reset()
    promocionesBackend = []
  })

  it('una promo porcentaje con scope de ítems manda el body que el service espera', async () => {
    postPromocionFalla = true
    const wrapper = await montar()
    await abrirCrear(wrapper)

    const nombreInput = dialogo()?.querySelector<HTMLInputElement>('input[placeholder="2x1 martes"]')
    expect(nombreInput, 'input Nombre').toBeTruthy()
    nombreInput!.value = 'Happy hour test'
    nombreInput!.dispatchEvent(new Event('input', { bubbles: true }))

    const pctInput = dialogo()?.querySelector<HTMLInputElement>('input[placeholder="0.10 (= 10%)"]')
    expect(pctInput, 'input Porcentaje').toBeTruthy()
    pctInput!.value = '0.20'
    pctInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 10))

    // `tipoScope` del único scope ya nace en 'items' (default de `scopeVacio`),
    // así que alcanza con elegir los ítems — no hace falta tocar el select de
    // condición.
    await elegirItems(wrapper, ['item-1'])
    await setFecha('promocion-fecha-inicio', '2026-01-01')
    await setFecha('promocion-fecha-fin', '2026-12-31')

    await clickBoton('Crear')

    expect(postsPromocion).toHaveLength(1)
    const body = postsPromocion[0]!
    expect(body).toMatchObject({
      nombre: 'Happy hour test',
      descripcion: null,
      activo: true,
      tipo: 'porcentaje',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
      horaInicio: null,
      horaFin: null,
      diasSemana: null,
      canal: null,
      valorPorcentaje: '0.20',
      cadaN: null,
      valorMonto: null,
    })
    expect(body.scopes).toEqual([
      { tipoScope: 'items', categoriaId: null, itemIds: ['item-1'], cantidad: undefined },
    ])

    wrapper.unmount()
  })
})
