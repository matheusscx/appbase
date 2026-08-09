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
/** El body de cada uno: quién dijo la pantalla que abría la cuenta. */
let bodiesAbrirCuenta: Record<string, unknown>[] = []
/**
 * Las URLs COMPLETAS pedidas al selector, con query string. Se guardan enteras a
 * propósito: el mock antes cortaba en el `?`, así que `enTurno` era invisible
 * para los tests y se podía borrar el param —lo que en producción hace que el
 * endpoint responda 400 en toda llamada— con la suite entera en verde.
 */
let urlsSelector: string[] = []
/**
 * Qué devuelve `GET /garzones/mi-vinculo`. `null` es el dispositivo compartido
 * (se pide PIN); un objeto con `garzonId` es la tablet personal del garzón.
 */
let vinculoPersonal: { garzonId: string, nombre: string } | null | unknown = null
/** Fuerza al POST de abrir cuenta a rechazar con el error que abre el modal de turno. */
let sinSesionDeTrabajo = false
/** Retiene la respuesta del POST para dejarlo "en vuelo" el tiempo que el test quiera. */
let abrirCuentaRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (
    url: string,
    opts?: { method?: string, body?: Record<string, unknown> },
  ) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const method = opts?.method ?? 'GET'
    const ruta = url.split('?')[0] ?? ''

    if (/\/mesas\/[^/]+\/cuentas$/.test(ruta)) {
      if (method === 'POST') {
        postsAbrirCuenta.push(ruta)
        bodiesAbrirCuenta.push(opts?.body ?? {})
        if (sinSesionDeTrabajo) {
          const err = new Error('x') as Error & { data?: unknown }
          err.data = {
            message: 'El garzón no tiene una sesión de trabajo abierta',
          }
          return Promise.reject(err)
        }
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
    if (ruta.endsWith('/turnos')) {
      return Promise.resolve([
        { id: 'turno-1', nombre: 'Mañana', activo: true },
      ])
    }
    if (ruta.endsWith('/garzones/para-selector')) {
      urlsSelector.push(url)
      // Dos garzones a propósito: con uno solo, un selector que ignorara la
      // elección y tomara siempre el primero pasaría igual.
      return Promise.resolve([
        { garzonId: 'g1', nombre: 'Ana' },
        { garzonId: 'g2', nombre: 'Bruno' },
      ])
    }
    // El modo del dispositivo. `null` = compartido, se pide PIN: es lo que
    // ejercitan los tests de más abajo, y lo que NO puede salir del catch-all
    // —que devuelve `[]`, y un array vacío es **truthy**—.
    if (ruta.endsWith('/garzones/mi-vinculo')) {
      return Promise.resolve(vinculoPersonal)
    }
    if (ruta.endsWith('/garzones/verificar-pin')) {
      return Promise.resolve({ garzonId: 'g1', nombre: 'Ana' })
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

/**
 * El modal de identificación tiene DOS pasos con textos distintos —elegir
 * garzón y teclear— así que discriminar por uno solo dejaría al drawer
 * matcheando el otro. Los dos localizadores comparten este predicado para no
 * poder desincronizarse.
 */
function esModalPin(d: HTMLElement): boolean {
  const texto = d.textContent ?? ''
  return texto.includes('Ingresa tu PIN') || texto.includes('Elegí quién sos')
}

function tecladoPin(): HTMLElement | undefined {
  return dialogos().find(esModalPin)
}

function drawerMesa(): HTMLElement | undefined {
  return dialogos().find(d => !esModalPin(d))
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
async function rondaDePin(quien = 'Ana'): Promise<boolean> {
  const abrir = botonEn(drawerMesa(), 'Nueva cuenta')
  if (!abrir || abrir.disabled) return false
  abrir.click()
  await esperar(10)
  // Paso nuevo: el teclado no aparece hasta elegir de quién es el PIN.
  const garzon = botonEn(tecladoPin(), quien)
  if (!garzon) return false
  garzon.click()
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
    bodiesAbrirCuenta = []
    urlsSelector = []
    sinSesionDeTrabajo = false
    abrirCuentaRetenido = null
    vinculoPersonal = null
  })

  it('una ronda de PIN abre UNA cuenta (el camino feliz sigue vivo)', async () => {
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin()).toBe(true)

    expect(postsAbrirCuenta).toHaveLength(1)
  })

  // El fixture tiene DOS garzones a propósito: con uno solo, una pantalla que
  // ignorara la elección y mandara siempre el primero pasaría igual.
  it('manda el garzón que se eligió, no el primero de la lista', async () => {
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin('Bruno')).toBe(true)

    expect(bodiesAbrirCuenta).toHaveLength(1)
    expect(bodiesAbrirCuenta[0]).toMatchObject({ garzonId: 'g2', pin: '111111' })
    wrapper.unmount()
  })

  // Abrir una cuenta exige sesión abierta, así que el selector tiene que
  // ofrecer a los que ESTÁN en turno. Y el param tiene que viajar: el DTO no
  // tiene default a propósito, así que sin él el backend responde 400 y el
  // selector no carga nunca.
  it('pide la lista de los que están en turno, con el param explícito', async () => {
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    expect(await rondaDePin()).toBe(true)

    expect(urlsSelector).toHaveLength(1)
    expect(urlsSelector[0]).toContain('enTurno=true')
    wrapper.unmount()
  })

  // El ÚNICO flujo con la lista invertida, y por eso el único que puede cazar
  // un `enTurno` cableado a `true`. Entrar a turno lista a los que NO están:
  // ofrecer a alguien con sesión abierta sería ofrecerle un 400.
  it('entrar a turno pide la lista de los que NO están en turno', async () => {
    sinSesionDeTrabajo = true
    const wrapper = await montar()
    await seleccionarMesa(wrapper)

    // Abrir cuenta falla por falta de sesión → la pantalla abre el modal de turno.
    await rondaDePin()
    const modalTurno = dialogos().find(d =>
      d.textContent?.includes('Entrar a turno'),
    )
    expect(modalTurno, 'modal de entrar a turno').toBeTruthy()
    botonEn(modalTurno, 'Continuar')?.click()
    await esperar(30)

    expect(urlsSelector.at(-1)).toContain('enTurno=false')
    wrapper.unmount()
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

  // ── Modo personal (tablet del garzón) ────────────────────────────────────
  //
  // El mismo embudo `solicitarPin` con la otra rama: acá no hay teclado, porque
  // el JWT ya dice quién es. Lo que se afirma es la CONDUCTA de la pantalla —no
  // aparece el modal y el POST igual sale— y sobre todo **qué manda en el body**.
  describe('con la cuenta vinculada a un garzón', () => {
    it('abre la cuenta sin mostrar el teclado de PIN', async () => {
      vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }

      const wrapper = await montar()
      await seleccionarMesa(wrapper)
      const boton = botonEn(drawerMesa(), 'Nueva cuenta')
      expect(boton).toBeTruthy()
      boton!.click()
      await esperar(30)

      // Sin teclado: el modal de PIN no llegó a existir.
      expect(tecladoPin()).toBeUndefined()
      expect(postsAbrirCuenta).toHaveLength(1)
    })

    // ⚠️ Lo que hace que esto NO sea un bypass. Mandar `pin: ''` rebota contra
    // el `@Matches(/^\d{6}$/)` del DTO con un 400: la credencial se **omite**, y
    // el backend resuelve la identidad del JWT por su cuenta.
    it('no manda credencial en el body: ni garzonId ni pin', async () => {
      vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }

      const wrapper = await montar()
      await seleccionarMesa(wrapper)
      botonEn(drawerMesa(), 'Nueva cuenta')!.click()
      await esperar(30)

      expect(bodiesAbrirCuenta).toHaveLength(1)
      expect(bodiesAbrirCuenta[0]).not.toHaveProperty('pin')
      expect(bodiesAbrirCuenta[0]).not.toHaveProperty('garzonId')
    })

    // ⚠️ El caso que casi se cuela: un body vacío puede llegar como `{}` según
    // cómo se serialice, y `{}` es **truthy**. Si el vínculo se evaluara por
    // verdad y no por su `garzonId`, el PIN quedaría apagado para TODOS.
    it('un objeto vacío NO es un vínculo: sigue pidiendo PIN', async () => {
      vinculoPersonal = {}

      const wrapper = await montar()
      await seleccionarMesa(wrapper)

      expect(await rondaDePin()).toBe(true)
      expect(bodiesAbrirCuenta[0]).toHaveProperty('pin')
    })
  })
})
