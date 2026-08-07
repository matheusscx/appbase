// @vitest-environment nuxt
//
// Primer spec de `pages/salones/index.vue`. Cubre UNA cosa: el guard de
// reentrancia de "Nueva cuenta". El molde es el de las páginas hermanas que ya
// prueban este patrón (`configuracion/garzones.nuxt.spec.ts` § "dos clicks en
// Restaurar mandan UN solo POST"), adaptado a que acá la segunda invocación no
// es un segundo click en un botón sino una **ronda completa de PIN**: el modal
// se cierra apenas emite `confirm`, así que la UI vuelve a estar interactuable
// con el POST todavía en vuelo.
//
// Por qué el backend no puede defenderlo: varias cuentas abiertas por mesa es
// comportamiento intencional, así que dos POST son dos cuentas legítimas para
// la API. El guard vive en el cliente o no vive.
//
// `GarzonPinModal` se usa REAL, no stubeado: parte de lo que hay que ejercitar
// es justamente que el modal emite `confirm` y recién ahí se cierra. Lo único
// mockeado es el HTTP (`useApiFetch`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Salones from './index.vue'

const MESA_ID = 'mesa-1'

function mesa() {
  return {
    id: MESA_ID,
    nombre: 'Mesa 1',
    posX: '0',
    posY: '0',
    forma: 'cuadrada',
    tamano: 'mediano',
    cuentasAbiertas: 0,
    ocupada: false,
  }
}

/** Cada `POST /mesas/:id/cuentas` recibido: el contador del doble submit. */
let postsAbrirCuenta: string[] = []
/** Retiene la respuesta del POST para dejarlo "en vuelo" el tiempo que el test quiera. */
let abrirCuentaRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const method = opts?.method ?? 'GET'
    const ruta = url.split('?')[0] ?? ''

    if (/\/mesas\/[^/]+\/cuentas$/.test(ruta)) {
      if (method === 'POST') {
        postsAbrirCuenta.push(ruta)
        const cuenta = {
          id: `cuenta-${postsAbrirCuenta.length}`,
          numero: postsAbrirCuenta.length,
          nombre: null,
          estado: 'abierta',
          mesaId: MESA_ID,
          ventaId: null,
          garzonAperturaId: 'g1',
          garzonAperturaNombre: 'Ana',
          garzonResponsableId: 'g1',
          garzonResponsableNombre: 'Ana',
          garzonCierreId: null,
          garzonCierreNombre: null,
          lineas: [],
        }
        // Sin retención resuelve de una, como en producción; con retención el
        // test decide cuándo, y ahí es donde vive la ventana del doble submit.
        return abrirCuentaRetenido
          ? abrirCuentaRetenido.then(() => cuenta)
          : Promise.resolve(cuenta)
      }
      return Promise.resolve([])
    }

    // El teclado de PIN resuelve al garzón contra el backend ANTES de emitir
    // `confirm`: sin esto el flujo nunca llega a abrir la cuenta.
    if (ruta.endsWith('/garzones/identificar')) {
      return Promise.resolve({ id: 'g1', nombre: 'Ana' })
    }
    if (ruta.endsWith('/salones/operacion')) {
      return Promise.resolve([{ id: 'salon-1', nombre: 'Principal', mesas: [mesa()] }])
    }
    if (ruta.endsWith('/propinas/porcentaje-sugerido')) {
      return Promise.resolve({ porcentajeSugerido: '0.1', habilitado: true })
    }
    if (ruta.includes('/items')) {
      return Promise.resolve({ data: [], total: 0, page: 1, pageSize: 100 })
    }
    // El resto del arranque (métodos de pago, tipos de documento, unidades,
    // caja, emisor) no interviene en este flujo.
    return Promise.resolve([])
  }
})

async function esperar(ms: number) {
  await new Promise(r => setTimeout(r, ms))
}

/**
 * El wrapper se recuerda para desmontarlo en un `afterEach` y NO al final de
 * cada `it`: los diálogos van teletransportados a un `document.body` que los
 * tests comparten, así que un test que falla antes de su `unmount()` deja su
 * drawer vivo y el siguiente lo encuentra en vez del suyo. El riesgo es un
 * falso ROJO en cascada —medido: con el guard revertido, el test del doble
 * submit arrastraba al del `finally`, que aislado pasaba— y desmontar acá corre
 * pase o falle.
 */
let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
})

async function montar() {
  const wrapper = await mountSuspended(Salones)
  montado = wrapper
  await esperar(0)
  return wrapper
}

/**
 * `AppDrawer` y `UModal` teletransportan su contenido fuera del wrapper, así
 * que la búsqueda va sobre `document.body` — igual que en los specs hermanos.
 *
 * ⚠️ Y por eso mismo cada búsqueda se acota a SU diálogo en vez de barrer el
 * body entero: es la trampa que documenta `configuracion/garzones.nuxt.spec.ts`
 * — si dos botones comparten texto, el test "confirma" sobre el equivocado y
 * pasa igual. Acá conviven dos diálogos a la vez (el drawer de la mesa y el
 * teclado), y en un test de doble submit un falso verde es especialmente
 * barato: "no pasó nada" es justo lo que la aserción espera ver.
 */
function dialogos(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')]
}

function tecladoPin(): HTMLElement | undefined {
  return dialogos().find(d => d.textContent?.includes('Ingresa tu PIN'))
}

function drawerMesa(): HTMLElement | undefined {
  return dialogos().find(d => !d.textContent?.includes('Ingresa tu PIN'))
}

function botonEn(contenedor: HTMLElement | undefined, texto: string) {
  return contenedor
    ? [...contenedor.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)
    : undefined
}

/**
 * Una ronda completa de apertura: abrir el teclado y tipear los 6 dígitos
 * (el modal verifica y emite `confirm` solo al sexto).
 *
 * No fuerza el camino: si el botón está deshabilitado —que es exactamente lo
 * que hace `:loading="abriendoCuenta"`— devuelve `false` en vez de clickearlo,
 * igual que un usuario. Así los tests pueden afirmar sobre la ronda además de
 * sobre el contador de POST.
 */
async function rondaDePin(): Promise<boolean> {
  const abrir = botonEn(drawerMesa(), 'Nueva cuenta')
  if (!abrir || abrir.disabled) return false
  abrir.click()
  await esperar(10)
  for (let i = 0; i < 6; i++) {
    const digito = botonEn(tecladoPin(), '1')
    if (!digito) return false
    digito.click()
    await esperar(1)
  }
  await esperar(20)
  return true
}

async function seleccionarMesa(wrapper: Awaited<ReturnType<typeof montar>>) {
  wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', mesa())
  await esperar(20)
}

describe('salones — guard de reentrancia de "Nueva cuenta"', () => {
  beforeEach(() => {
    postsAbrirCuenta = []
    abrirCuentaRetenido = null
  })

  it('una ronda de PIN abre UNA cuenta (el camino feliz sigue vivo)', async () => {
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin()).toBe(true)

    expect(postsAbrirCuenta).toHaveLength(1)
  })

  // El corazón de la entrada: doble tap o lag de red. Sin el guard, la segunda
  // ronda con el primer POST en vuelo abre una SEGUNDA cuenta en la mesa, y el
  // backend la acepta porque varias cuentas por mesa es válido.
  it('dos rondas de PIN con el POST en vuelo mandan UN solo POST', async () => {
    let soltar: () => void = () => {}
    abrirCuentaRetenido = new Promise<void>((resolve) => { soltar = resolve })

    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin()).toBe(true)
    // Segunda ronda con el primer POST todavía sin resolver. Puede quedar
    // frenada en el botón (`:loading`) o en el early-return de
    // `abrirCuentaConPin`: las dos mitades del guard son válidas. Lo que no
    // puede pasar es un segundo POST.
    await rondaDePin()

    soltar()
    await esperar(60)

    expect(postsAbrirCuenta).toHaveLength(1)
  })

  // La otra mitad del guard: que se libere. Un guard que no baja el flag
  // convierte el bug en uno peor —la mesa no acepta ninguna cuenta más— y el
  // test del doble submit, solo, no lo notaría.
  it('después de abrir una cuenta se puede abrir otra (el guard se libera)', async () => {
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin()).toBe(true)
    // Abrir una cuenta lleva al detalle, así que "Nueva cuenta" deja de estar
    // en pantalla: para abrir otra hay que volver a la mesa, como el usuario.
    // Volver NO toca `abriendoCuenta`, así que si el guard no se hubiera
    // liberado el botón seguiría deshabilitado y esta ronda daría `false`.
    await seleccionarMesa(wrapper)
    expect(await rondaDePin()).toBe(true)

    expect(postsAbrirCuenta).toHaveLength(2)
  })
})
