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
const CLP_ID = 'clp'

/**
 * La moneda del tenant, para que `formatMonto` rinda plata de verdad.
 *
 * No es decorado: con el store vacío `useCurrency().format` devuelve `'—'` para
 * **cualquier** monto, así que un test que afirme sobre lo que muestra la
 * cabecera de Totales no puede distinguir "$5.000" de "tapado". Lo cazó la
 * revisión independiente: dos aserciones escritas así no podían fallar bajo
 * ninguna mutación.
 */
const MONEDA_CLP = {
  monedaId: CLP_ID,
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

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
/**
 * Lo que devuelve `GET /mesas/:id/cuentas`. Vacío por defecto —la mesa recién
 * abierta— y lo llena el `describe` del ítem eliminado.
 */
let cuentasDeLaMesa: unknown[] = []
/** Las URLs completas del catálogo. Ver la rama `/items` del mock. */
let urlsCatalogo: string[] = []
/**
 * Lo que devuelven los tres `GET /items`. Vacío por defecto —a los tests que
 * solo cuentan URLs no les importa el contenido— y lo llena el `describe` de la
 * disponibilidad, que sí necesita una tarjeta con números en el DOM.
 */
let catalogoItemsMock: unknown[] = []
/** Los bodies de cada `POST /cuentas/:id/lineas`. Ver la rama del mock. */
let lineasAgregadas: { itemId?: string, cantidad?: string }[] = []
/** Cada `PATCH` de cantidad recibido, en orden. Ver la rama del mock. */
let patchesDeCantidad: { lineaId: string, cantidad: string }[] = []
/** Cada `POST /calculo-precios/calcular`. Es la señal de que la pantalla movió el carrito. */
let calculosPedidos: string[] = []
/**
 * `POST /calculo-precios/calcular` falla. Es lo que hace el backend real cuando
 * una línea apunta a un ítem borrado del catálogo: 404, porque el motor resuelve
 * los ítems contra el catálogo vivo.
 */
let calculoFalla = false
/** Lo que devuelve `POST /caja/testigos/pendientes`. */
let pendientesTestigoMock: unknown[] = []
/** Cada `POST /caja/testigos/pendientes` recibido, con su body (la credencial). */
let bodiesPendientesTestigo: Record<string, unknown>[] = []
/** Cada `POST /caja/testigos/:id/resolver` recibido: el id de la URL + su body. */
let resolucionesTestigo: { testigoId: string, body: Record<string, unknown> }[] = []
/** Fuerza el resolver a rechazar con el 403 "vinculado a una cuenta" del backend. */
let resolverRechazaVinculo = false
/** Lo que devuelve `GET /garzones/mi-pin`. `null` = sin datos (dispositivo compartido). */
let miPinMock: { fijado: boolean, eventos: unknown[] } | null = null
/**
 * Lo que devuelve `GET /salones/operacion`. Por defecto un salón con una
 * mesa (lo que casi todos los tests de este archivo necesitan); un `[]`
 * prueba que el aviso de PIN no depende de que existan salones.
 */
let salonesMock: unknown[] = [{ id: 'salon-1', nombre: 'Principal', mesas: [mesa()] }]
/**
 * Fuerza el rechazo de `GET /garzones/mi-pin` (el 404 real de una cuenta que
 * no es garzón, o cualquier otra falla). Solo sirve para probar que el
 * `.catch(() => null)` de la llamada nueva no deja caer el resto del arranque.
 */
let miPinRechaza = false
/**
 * Fuerza `/items` (×3) y `/tipos-documento` a rechazar con el 403 real de un
 * rol sin permiso de catálogo (dato del POS que un garzón no ve).
 */
let catalogoRechaza403 = false
/** Fuerza `/metodos-pago` a rechazar con un error genérico — NO un 403 de permiso. */
let metodosPagoRechaza = false

/**
 * Los toasts no se pueden leer del DOM sin montar `UApp`, así que se captura
 * el composable — mismo patrón que `configuracion/garzones.nuxt.spec.ts`. Es
 * lo único que permite afirmar el COLOR: un toast que saliera con otro color
 * se vería igual en un assert sobre el texto del wrapper.
 */
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => {
      toasts.push(t)
    },
  })
})

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
      return Promise.resolve(cuentasDeLaMesa)
    }

    // `POST /cuentas/:id/lineas` — agregar un ítem a la cuenta abierta. Lo usa
    // el describe de la disponibilidad: es la única forma de mover lo pedido
    // SIN cambiar de mesa ni de cuenta, que es la conducta que ahí se fija.
    // Devuelve la cuenta con la línea nueva, como el backend.
    if (/\/cuentas\/[^/]+\/lineas$/.test(ruta) && method === 'POST') {
      const body = (opts?.body ?? {}) as { itemId?: string, cantidad?: string }
      lineasAgregadas.push(body)
      const cuenta = cuentasDeLaMesa[0] as { lineas: unknown[] }
      return Promise.resolve({
        ...cuenta,
        lineas: [
          ...cuenta.lineas,
          {
            id: `linea-nueva-${lineasAgregadas.length}`,
            itemId: body.itemId,
            nombre: 'Agregado',
            precioBase: '1500',
            monedaId: CLP_ID,
            cantidad: body.cantidad ?? '1',
          },
        ],
      })
    }

    // `PATCH /cuentas/:id/lineas/:lineaId` — cambiar la cantidad de una línea.
    // Devuelve la cantidad **tal cual la mandó el cliente**, que es el caso que
    // interesa: cuando el eco del servidor coincide string a string con lo que
    // el optimista ya pintó, la firma del watch no cambia por formato.
    const patchLinea = ruta.match(/\/cuentas\/[^/]+\/lineas\/([^/]+)$/)
    if (patchLinea && method === 'PATCH') {
      const body = (opts?.body ?? {}) as { cantidad?: string }
      patchesDeCantidad.push({ lineaId: patchLinea[1] ?? '', cantidad: body.cantidad ?? '' })
      const cuenta = cuentasDeLaMesa[0] as { lineas: { id: string }[] }
      return Promise.resolve({
        ...cuenta,
        lineas: cuenta.lineas.map(l =>
          l.id === patchLinea[1] ? { ...l, cantidad: body.cantidad } : l,
        ),
      })
    }

    if (ruta.endsWith('/calculo-precios/calcular')) {
      calculosPedidos.push(ruta)
      // El backend responde 404 si una línea apunta a un ítem borrado: el motor
      // resuelve los ítems contra el catálogo vivo (`items.service.ts` →
      // `cargarBasePorIds` filtra `eliminado_el IS NULL`).
      if (calculoFalla) return Promise.reject(new Error('Ítem no encontrado'))
      // La forma completa de `ResultadoVenta`, no la que este test consume: una
      // respuesta recortada le deja una trampa al próximo test que toque el
      // cobro, que lee `lineas[].trazas.impuestos`.
      const trazas = { descuentos: [], recargos: [], impuestos: [] }
      return Promise.resolve({
        lineas: [{
          itemId: 'item-1',
          cantidad: '1',
          precioUnitario: '5000',
          subtotalNeto: '5000',
          descuentoAplicado: '0',
          recargoAplicado: '0',
          impuestoAplicado: '0',
          totalLinea: '5000',
          trazas,
          advertencias: [],
        }],
        totales: {
          subtotalNeto: '5000',
          totalDescuentos: '0',
          totalRecargos: '0',
          totalImpuestos: '0',
          totalFinal: '5000',
        },
        trazasVenta: { descuentos: [], recargos: [] },
        advertencias: [],
        advertenciasVenta: [],
      })
    }

    // Caja abierta EXPLÍCITA. El catch-all devuelve `[]`, que es un objeto y por
    // lo tanto el store lo toma como caja activa: el botón de cobro quedaría
    // habilitado por accidente, que es la misma trampa del `{}` truthy que
    // documenta el mock de `mi-vinculo`.
    if (ruta.endsWith('/caja/activa')) {
      return Promise.resolve({ id: 'caja-1', estado: 'abierta' })
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
    if (ruta.endsWith('/garzones/mi-pin')) {
      if (miPinRechaza) {
        const err = new Error('x') as Error & { status?: number }
        err.status = 404
        return Promise.reject(err)
      }
      return Promise.resolve(miPinMock)
    }
    if (ruta.endsWith('/garzones/verificar-pin')) {
      return Promise.resolve({ garzonId: 'g1', nombre: 'Ana' })
    }
    if (ruta.endsWith('/salones/operacion')) {
      return Promise.resolve(salonesMock)
    }
    if (ruta.endsWith('/propinas/porcentaje-sugerido')) {
      return Promise.resolve({ porcentajeSugerido: '0.1', habilitado: true })
    }
    if (ruta.includes('/items')) {
      // La URL ENTERA, con query string: el filtro de pausados vive ahí desde
      // que dejó de hacerse en el cliente, y si el mock cortara en el `?` se
      // podría borrar con la suite en verde. Mismo motivo que `urlsSelector`.
      urlsCatalogo.push(url)
      if (catalogoRechaza403) {
        const err = new Error('x') as Error & { data?: unknown }
        err.data = { message: 'No tienes permiso para esta acción' }
        return Promise.reject(err)
      }
      // Filtrado por `tipo` como lo hace el backend: la pantalla hace TRES
      // llamadas y las concatena, así que devolver el mismo ítem en las tres lo
      // dejaría tres veces en la grilla.
      const tipo = url.match(/tipo=(\w+)/)?.[1]
      const data = catalogoItemsMock.filter(
        i => (i as { tipo?: string }).tipo === tipo,
      )
      return Promise.resolve({
        data,
        meta: { total: data.length, page: 1, pageSize: 100 },
      })
    }
    if (ruta.endsWith('/tipos-documento')) {
      if (catalogoRechaza403) {
        const err = new Error('x') as Error & { data?: unknown }
        err.data = { message: 'No tienes permiso para esta acción' }
        return Promise.reject(err)
      }
      return Promise.resolve([{ id: 'tipo-1', nombre: 'Boleta', customerRequerido: false }])
    }
    if (ruta.endsWith('/metodos-pago')) {
      if (metodosPagoRechaza) {
        const err = new Error('x') as Error & { data?: unknown }
        err.data = { message: 'Error al leer métodos de pago' }
        return Promise.reject(err)
      }
      return Promise.resolve([{ metodoPagoId: 'mp-1', nombre: 'Efectivo', permiteVuelto: true, habilitada: true }])
    }
    if (ruta.endsWith('/caja/testigos/pendientes')) {
      bodiesPendientesTestigo.push(opts?.body ?? {})
      return Promise.resolve(pendientesTestigoMock)
    }
    const resolverMatch = ruta.match(/\/caja\/testigos\/([^/]+)\/resolver$/)
    if (resolverMatch) {
      const testigoId = resolverMatch[1] ?? ''
      const body = opts?.body ?? {}
      resolucionesTestigo.push({ testigoId, body })
      if (resolverRechazaVinculo) {
        const err = new Error('x') as Error & { data?: unknown }
        err.data = {
          message: 'Este garzón está vinculado a una cuenta: la firma tiene que hacerse desde esa cuenta, no por PIN',
        }
        return Promise.reject(err)
      }
      return Promise.resolve({
        id: testigoId,
        estado: (body as { firma?: boolean }).firma ? 'firmada' : 'rechazada',
      })
    }
    // El resto del arranque (unidades, caja, emisor) no interviene en este flujo.
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

/**
 * Reset del estado del **mock HTTP**. Compartido por los dos `describe`: dos
 * listas paralelas se desincronizan en cuanto se agregue la próxima variable.
 *
 * El estado que vive fuera del mock —el store de monedas— lo limpia el
 * `afterEach` de arriba, que corre pase o falle el test.
 */
function reiniciarMock() {
  postsAbrirCuenta = []
  bodiesAbrirCuenta = []
  urlsSelector = []
  urlsCatalogo = []
  catalogoItemsMock = []
  lineasAgregadas = []
  patchesDeCantidad = []
  calculosPedidos = []
  sinSesionDeTrabajo = false
  abrirCuentaRetenido = null
  vinculoPersonal = null
  cuentasDeLaMesa = []
  calculoFalla = false
  pendientesTestigoMock = []
  bodiesPendientesTestigo = []
  resolucionesTestigo = []
  resolverRechazaVinculo = false
  miPinMock = null
  miPinRechaza = false
  salonesMock = [{ id: 'salon-1', nombre: 'Principal', mesas: [mesa()] }]
  catalogoRechaza403 = false
  metodosPagoRechaza = false
  toasts = []
}

afterEach(() => {
  montado?.unmount()
  montado = null
  // El Pinia se comparte entre los tests del archivo, así que la moneda que
  // hidrata un test sobrevive al siguiente. Hoy no rompe nada —el primer
  // `describe` no afirma sobre plata— pero es una dependencia de orden latente,
  // justo la clase de fragilidad que este spec vino a sacar.
  useMonedasStore().reset()
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
  beforeEach(reiniciarMock)

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

/**
 * Una línea cuyo ítem se borró del catálogo bloquea la cuenta entera.
 *
 * El motor de precios resuelve los ítems contra el catálogo vivo, así que el
 * cálculo devuelve 404 y `resultado` se queda en `null` — o sea `totalFinal`
 * vale `'0'`. Sin el aviso, la cabecera mostraba **Total $0** para una cuenta
 * con productos, que es peor que no mostrar nada: invita a cobrar cero.
 *
 * Estaba anotado como hueco con el mutante medido: `computed(() => false)`
 * dejaba el frontend entero en verde. Lo que faltaba era el fixture, no el
 * arnés — una cuenta que ya venga con la línea marcada, que el mock del POST no
 * produce porque abre cuentas vacías.
 */
describe('salones — cuenta con un ítem eliminado del catálogo', () => {
  const LINEA_BASE = {
    id: 'linea-1',
    itemId: 'item-1',
    nombre: 'Producto viejo',
    precioBase: '5000',
    monedaId: 'clp',
    cantidad: '1',
  }

  function cuentaCon(linea: Record<string, unknown>) {
    return {
      id: 'cuenta-9',
      numero: 9,
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
      lineas: [linea],
    }
  }

  beforeEach(reiniciarMock)

  /**
   * Monta con la moneda del tenant cargada.
   *
   * ⚠️ Sin esto `formatMonto` devuelve `'—'` para cualquier monto, así que la
   * fila de Totales se ve **idéntica** con y sin el computed y toda aserción
   * sobre ella es inerte. Se hidrata después de montar y antes de abrir el
   * drawer: la fila se rinde recién al entrar a la cuenta.
   */
  async function montarConMoneda() {
    const wrapper = await montar()
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    await esperar(0)
    return wrapper
  }

  /** Selecciona la mesa y entra a la única cuenta que tiene. */
  async function abrirLaCuenta(wrapper: Awaited<ReturnType<typeof montar>>) {
    await seleccionarMesa(wrapper)
    const tarjeta = drawerMesa()?.querySelector<HTMLElement>('.cursor-pointer')
    expect(tarjeta).toBeTruthy()
    tarjeta!.click()
    await esperar(20)
  }

  /**
   * El valor de la fila "Total", no el `textContent` del drawer.
   *
   * Barrer el drawer entero no sirve: la cabecera rinde `— Cuenta 9` apenas hay
   * cuenta activa, así que un `toContain('—')` da verde siempre.
   */
  function valorDelTotal(): string {
    const spans = [...(drawerMesa()?.querySelectorAll('span') ?? [])]
    const etiqueta = spans.find(s => s.textContent?.trim() === 'Total')
    return etiqueta?.nextElementSibling?.textContent?.trim() ?? ''
  }

  /**
   * Decisión del owner (2026-08-08): lo ya despachado a cocina no se quita en
   * silencio — el plato se hizo, así que sacarlo del sistema lo regala sin
   * registro. El backend lo rechaza con 400; la pantalla no ofrece el botón,
   * para no mandar al garzón contra un error evitable.
   */
  it('el tacho de una línea ya despachada a cocina queda deshabilitado, con el motivo', async () => {
    cuentasDeLaMesa = [cuentaCon({ ...LINEA_BASE, cantidadEnviada: '2' })]

    const wrapper = await montarConMoneda()
    await abrirLaCuenta(wrapper)

    const tacho = drawerMesa()?.querySelector<HTMLButtonElement>(
      'button[title*="cocina"]',
    )
    expect(tacho).toBeTruthy()
    expect(tacho!.disabled).toBe(true)
    expect(tacho!.title).toContain('merma o cortesía')
  })

  it('sin nada despachado el tacho sigue habilitado: el garzón se puede corregir', async () => {
    // El contraste que hace falsable al de arriba: un `disabled` fijo lo
    // dejaría pasar igual.
    cuentasDeLaMesa = [cuentaCon({ ...LINEA_BASE, cantidadEnviada: '0' })]

    const wrapper = await montarConMoneda()
    await abrirLaCuenta(wrapper)

    const tacho = drawerMesa()?.querySelector<HTMLButtonElement>(
      'button[title="Quitar"]',
    )
    expect(tacho).toBeTruthy()
    expect(tacho!.disabled).toBe(false)
  })

  it('avisa, tapa el total y deshabilita el cobro', async () => {
    cuentasDeLaMesa = [cuentaCon({ ...LINEA_BASE, itemEliminado: true })]
    calculoFalla = true

    const wrapper = await montarConMoneda()
    await abrirLaCuenta(wrapper)

    expect(drawerMesa()?.textContent).toContain('Hay un ítem eliminado del catálogo')
    // Tapar el total es la mitad que importa: el cálculo falló, así que
    // `totalFinal` cae a `'0'` y la cabecera mostraría **Total $0** para una
    // cuenta con productos. Eso invita a cobrar cero.
    expect(valorDelTotal()).toBe('—')
    expect(botonEn(drawerMesa(), 'Cerrar y cobrar')?.disabled).toBe(true)
  })

  // El contraejemplo: sin él, un `computed(() => true)` —el mutante espejo—
  // pasaría el test de arriba dejando toda cuenta sana imposible de cobrar.
  it('la misma cuenta sin la marca cobra normal y muestra su total', async () => {
    cuentasDeLaMesa = [cuentaCon(LINEA_BASE)]

    const wrapper = await montarConMoneda()
    await abrirLaCuenta(wrapper)

    expect(drawerMesa()?.textContent).not.toContain('Hay un ítem eliminado del catálogo')
    expect(valorDelTotal()).toBe('$5.000')
    expect(botonEn(drawerMesa(), 'Cerrar y cobrar')?.disabled).toBe(false)
  })
})

/**
 * El catálogo del salón pide solo lo vendible.
 *
 * Hasta 2026-08-09 la pantalla traía todo y descartaba los pausados con un
 * `.filter(i => i.activo)`. No era equivalente: el pausado igual ocupaba uno de
 * los 100 lugares pedidos, así que con un catálogo grande cada ítem pausado
 * empujaba fuera del salón a uno vendible. Ahora el filtro va en la query, y
 * esto es lo único que lo sostiene del lado del cliente — borrar `activo=true`
 * de la URL no rompe ninguna otra cosa.
 */
describe('salones — el catálogo pide solo ítems vendibles', () => {
  beforeEach(reiniciarMock)

  it('las tres consultas de catálogo llevan `activo=true`', async () => {
    await montar()

    // Producto, receta y combo: las tres, no "alguna".
    expect(urlsCatalogo).toHaveLength(3)
    for (const url of urlsCatalogo) {
      expect(url).toContain('activo=true')
    }
    expect(urlsCatalogo.map(u => u.match(/tipo=(\w+)/)?.[1]).sort()).toEqual([
      'combo',
      'producto',
      'receta',
    ])
  })
})

/**
 * `/items` (×3) y `/tipos-documento` son carga DE FONDO al montar la pantalla
 * (`cargarCatalogo`, llamada una sola vez desde `onMounted`): un garzón no
 * tiene permiso de catálogo (dato del POS que ese rol no ve) y esas cuatro
 * rutas responden 403. Medido en el smoke del 2026-08-15 con la cuenta
 * `garzon.pin@paris.cl`: el toast rojo "No tienes permiso para esta acción"
 * salía apenas se abría `/salones`, sin que el garzón hubiera pedido nada —
 * misma familia que el `.catch(() => null)` que ya lleva `cargarActiva`
 * (`onMounted` más arriba), acá aplicado a las cuatro llamadas de
 * `cargarCatalogo` que también fallan para ese rol.
 *
 * `/metodos-pago` es la QUINTA llamada del mismo `Promise.all` y se queda
 * sin `.catch` propio a propósito: para un garzón esa sí resuelve, así que si
 * falla es un error real y tiene que seguir avisando — es el contraejemplo
 * del segundo test, que prueba que no se silenció de más.
 */
describe('salones — el catálogo silencia el 403 de carga inicial, no cualquier error', () => {
  beforeEach(reiniciarMock)

  it('un 403 de /items o /tipos-documento en el montaje no dispara ningún toast', async () => {
    catalogoRechaza403 = true

    await montar()

    expect(toasts).toEqual([])
  })

  // El contraejemplo obligatorio: si silenciáramos el `Promise.all` entero de
  // `cargarCatalogo` (en vez de cada llamada que sabemos que puede 403 para
  // este rol), un error real de `/metodos-pago` se perdería en silencio.
  it('un error real de /metodos-pago (no un 403 de permiso) sigue avisando', async () => {
    metodosPagoRechaza = true

    await montar()

    const errorToast = toasts.find(t => t.color === 'error')
    expect(errorToast?.title).toBe('Error al leer métodos de pago')
  })
})

/**
 * El garzón da fe (o rechaza) el conteo de un cierre forzado desde su propia
 * pantalla — la otra mitad de la feature (encargado: `stores/caja.ts` +
 * `CajaCierreForzadoPanel.vue`; acá el garzón: `POST /caja/testigos/pendientes`
 * + `POST /caja/testigos/:id/resolver`).
 */
describe('salones — testigo del cierre forzado (el garzón da fe)', () => {
  beforeEach(reiniciarMock)

  function solicitudTestigo(overrides: Record<string, unknown> = {}) {
    return {
      id: 'testigo-1',
      cajaId: 'caja-1',
      solicitadaEl: '2026-08-13T10:00:00.000Z',
      garzonVinculado: false,
      lineas: [
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, contado: '15000' },
      ],
      ...overrides,
    }
  }

  /** El modal de testigo, distinguido de los demás por su título fijo. */
  function modalTestigo(): HTMLElement | undefined {
    return dialogos().find(d => d.textContent?.includes('dar fe de un cierre'))
  }

  function campoPin(modal: HTMLElement | undefined): HTMLInputElement | undefined {
    return modal?.querySelector<HTMLInputElement>('input[aria-label="Tu PIN"]') ?? undefined
  }

  async function escribirPin(input: HTMLInputElement, valor: string) {
    input.value = valor
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar(10)
  }

  it('muestra la solicitud pendiente al entrar, en modo personal', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    pendientesTestigoMock = [solicitudTestigo({ garzonVinculado: true })]

    await montar()
    await esperar(20)

    // Aviso pasivo: nadie clickeó nada, la consulta salió sola al montar.
    expect(bodiesPendientesTestigo).toHaveLength(1)
    // Modo personal: sin credencial en el body, el JWT ya dice quién es —
    // mismo contrato que el resto de las acciones de esta pantalla.
    expect(bodiesPendientesTestigo[0]).not.toHaveProperty('garzonId')
    expect(bodiesPendientesTestigo[0]).not.toHaveProperty('pin')

    const modal = modalTestigo()
    expect(modal, 'modal de testigo').toBeTruthy()
    expect(modal?.textContent).toContain('Efectivo')
  })

  // El guardián del cierre ciego: si mañana alguien agrega el esperado al
  // render, este test tiene que morir.
  it('muestra LO CONTADO y NUNCA lo esperado', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    pendientesTestigoMock = [solicitudTestigo({
      garzonVinculado: true,
      lineas: [
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, contado: '15000' },
        { metodoPagoId: 'mp-1', nombre: 'Débito', esEfectivo: false, contado: '8000' },
      ],
    })]

    await montar()
    await esperar(20)

    const texto = modalTestigo()?.textContent ?? ''
    expect(texto).toContain('$15.000')
    expect(texto).toContain('$8.000')
    expect(texto.toLowerCase()).not.toContain('esperado')
  })

  it('con cuenta vinculada firma sin PIN; sin vínculo reusa el PIN ya tecleado, sin volver a pedirlo', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-vinculado', garzonVinculado: true })]

    const wrapper = await montar()
    await esperar(20)

    const modalVinculado = modalTestigo()
    expect(campoPin(modalVinculado), 'sin campo de PIN: vinculado').toBeUndefined()

    botonEn(modalVinculado, 'Dar fe')!.click()
    await esperar(20)

    expect(resolucionesTestigo).toHaveLength(1)
    expect(resolucionesTestigo[0]!.testigoId).toBe('testigo-vinculado')
    expect(resolucionesTestigo[0]!.body).not.toHaveProperty('pin')
    expect(resolucionesTestigo[0]!.body).toMatchObject({ firma: true })
    wrapper.unmount()
    montado = null

    // Sin vínculo (tótem): el PIN se prueba UNA vez, en el teclado enmascarado
    // del embudo `solicitarPin`, y de ahí lo reusa la firma. El modal NO puede
    // tener su propio campo de PIN: sería teclearlo dos veces y, sobre todo,
    // dejarlo a la vista en un dispositivo compartido.
    resolucionesTestigo = []
    vinculoPersonal = null
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-pin', garzonVinculado: false })]

    const wrapper2 = await montar()
    await esperar(20)

    const boton = wrapper2.findAll('button')
      .find(b => b.text().trim() === '¿Te pidieron firmar un cierre?')
    await boton!.trigger('click')
    await esperar(10)
    botonEn(tecladoPin(), 'Ana')!.click()
    await esperar(10)
    for (let i = 0; i < 6; i++) {
      botonEn(tecladoPin(), '1')!.click()
      await esperar(1)
    }
    await esperar(20)

    const modalPin = modalTestigo()
    expect(campoPin(modalPin), 'el modal NO vuelve a pedir el PIN').toBeUndefined()

    botonEn(modalPin, 'Dar fe')!.click()
    await esperar(20)

    expect(resolucionesTestigo).toHaveLength(1)
    expect(resolucionesTestigo[0]!.testigoId).toBe('testigo-pin')
    expect(resolucionesTestigo[0]!.body).toMatchObject({ firma: true, pin: '111111' })
    wrapper2.unmount()
  })

  // Un garzón CON cuenta propia operando desde el tótem: la firma no vale desde
  // ahí (`CajaTestigoService.resolver` ignora el PIN y exige el JWT de su
  // cuenta). Se le avisa ANTES de intentar, con el dato que ya trae la
  // solicitud, en vez de dejarlo chocar contra un 403.
  it('vinculado desde el tótem: avisa antes de intentar y no deja firmar', async () => {
    vinculoPersonal = null
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-vinc-totem', garzonVinculado: true })]

    const wrapper = await montar()
    await esperar(20)

    const boton = wrapper.findAll('button')
      .find(b => b.text().trim() === '¿Te pidieron firmar un cierre?')
    await boton!.trigger('click')
    await esperar(10)
    botonEn(tecladoPin(), 'Ana')!.click()
    await esperar(10)
    for (let i = 0; i < 6; i++) {
      botonEn(tecladoPin(), '1')!.click()
      await esperar(1)
    }
    await esperar(20)

    const modal = modalTestigo()
    expect(modal?.textContent).toContain('firmar desde tu cuenta')
    expect(botonEn(modal, 'Dar fe')?.disabled).toBe(true)

    botonEn(modal, 'Dar fe')!.click()
    await esperar(20)
    expect(resolucionesTestigo, 'no manda nada al backend').toHaveLength(0)
    wrapper.unmount()
  })

  it('rechazar permite comentario y no cuenta como firma', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-rechazo', garzonVinculado: true })]

    await montar()
    await esperar(20)

    const modal = modalTestigo()
    botonEn(modal, 'Rechazar')!.click()
    await esperar(10)

    const comentarioInput = modal?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Comentario del rechazo"]',
    )
    expect(comentarioInput, 'campo de comentario del rechazo').toBeTruthy()
    comentarioInput!.value = 'No vi el conteo, estaba en la cocina'
    comentarioInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar(10)

    botonEn(modal, 'Confirmar rechazo')!.click()
    await esperar(20)

    expect(resolucionesTestigo).toHaveLength(1)
    expect(resolucionesTestigo[0]!.body).toMatchObject({
      firma: false,
      comentario: 'No vi el conteo, estaba en la cocina',
    })
  })

  // Regresión (revisión independiente, 2026-08-13): abrir el rechazo, escribir,
  // cancelar y después dar fe adjuntaba ese texto a la FIRMA. El detalle del
  // cierre mostraba entonces un registro que se contradecía a sí mismo — el
  // dato que esta feature existe para hacer confiable.
  it('un comentario de rechazo cancelado NO viaja con la firma', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-cancelado', garzonVinculado: true })]

    await montar()
    await esperar(20)

    const modal = modalTestigo()
    botonEn(modal, 'Rechazar')!.click()
    await esperar(10)

    const comentarioInput = modal?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Comentario del rechazo"]',
    )
    comentarioInput!.value = 'No vi el conteo'
    comentarioInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar(10)

    botonEn(modal, 'Cancelar')!.click()
    await esperar(10)

    botonEn(modalTestigo(), 'Dar fe')!.click()
    await esperar(20)

    expect(resolucionesTestigo).toHaveLength(1)
    expect(resolucionesTestigo[0]!.body).toMatchObject({ firma: true })
    expect(resolucionesTestigo[0]!.body).not.toHaveProperty('comentario')
  })

  it('tótem compartido: no consulta sola al montar, y el botón dispara el PIN', async () => {
    vinculoPersonal = null
    pendientesTestigoMock = [solicitudTestigo({ garzonVinculado: false })]

    const wrapper = await montar()
    await esperar(20)

    // Sin vínculo personal, nadie sabe quién está parado adelante: no hay
    // consulta automática al montar.
    expect(bodiesPendientesTestigo).toHaveLength(0)
    expect(modalTestigo()).toBeUndefined()

    // Botón de la barra de herramientas, no teletransportado: se busca en el
    // wrapper (`findAll`), no en `document.body` como los diálogos.
    const boton = wrapper.findAll('button')
      .find(b => b.text().trim() === '¿Te pidieron firmar un cierre?')
    expect(boton, 'botón de entrada del tótem').toBeTruthy()
    await boton!.trigger('click')
    await esperar(10)

    // Se abre el teclado de PIN (el mismo embudo `solicitarPin` del resto de
    // la pantalla): elegir garzón y teclear.
    const teclado = tecladoPin()
    expect(teclado, 'teclado de PIN').toBeTruthy()
    botonEn(teclado, 'Ana')!.click()
    await esperar(10)
    for (let i = 0; i < 6; i++) {
      botonEn(tecladoPin(), '1')!.click()
      await esperar(1)
    }
    await esperar(20)

    expect(bodiesPendientesTestigo).toHaveLength(1)
    expect(bodiesPendientesTestigo[0]).toMatchObject({ garzonId: 'g1', pin: '111111' })
    expect(modalTestigo()).toBeTruthy()
    wrapper.unmount()
  })

  // El 403 exacto de `CajaTestigoService.resolver`: no es un error genérico,
  // es información para el garzón. Se muestra inline, nunca como toast rojo
  // indistinguible de un PIN mal tecleado.
  it('el 403 de "vinculado a una cuenta" se muestra como aviso, no como error genérico', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    pendientesTestigoMock = [solicitudTestigo({ id: 'testigo-vinculado', garzonVinculado: true })]
    resolverRechazaVinculo = true

    await montar()
    await esperar(20)

    const modal = modalTestigo()
    botonEn(modal, 'Dar fe')!.click()
    await esperar(20)

    expect(modalTestigo()?.textContent).toContain('vinculado a una cuenta')
  })
})

/**
 * El aviso de PIN invalidado: vive en el cuerpo de la página (no en un
 * diálogo), así que se busca en el wrapper directo, a diferencia de
 * `dialogos()` que barre `document.body`.
 */
describe('salones — aviso de PIN invalidado (modo personal)', () => {
  beforeEach(reiniciarMock)

  function botonPerfilEnAviso(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.findAll('a').find(a => a.text().trim() === 'Ir a mi perfil')
  }

  it('con el PIN invalidado por el encargado, avisa quién, cuándo, y que NO bloquea este dispositivo', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = {
      fijado: false,
      eventos: [
        { id: 'ev-1', tipo: 'invalidado_por_encargado', usuarioNombre: 'Bruno', creadoEl: '2026-08-10T12:00:00.000Z' },
      ],
    }

    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Bruno invalidó tu PIN (')
    // No bloquea: el bypass de modo personal sigue funcionando en ESTE
    // dispositivo, y el aviso no puede leerse como una alarma de que no se
    // puede trabajar.
    expect(texto).toContain('Desde este dispositivo trabajás normal; para el tótem compartido, hace falta ponerlo desde tu perfil.')
    // Guarda contra la puntuación doble: `formatFecha` termina en "a. m." /
    // "p. m." (con punto), así que pegarle un "." directo sin envolver la
    // fecha entre paréntesis deja "a. m..".
    expect(texto).not.toMatch(/\.\./)
    expect(botonPerfilEnAviso(wrapper)?.attributes('href')).toBe('/configuracion/perfil')
  })

  // El disparador DOMINANTE en producción: este aviso solo vive en modo
  // personal, y entrar a modo personal (vincular la cuenta) es justo lo que
  // emite este tipo de evento. Fusionarlo con el texto de "el encargado te
  // cortó el PIN" sería la mentira más frecuente que podría contar el aviso.
  it('con el PIN invalidado por VINCULAR la cuenta, usa el texto de vínculo, no el de "invalidó"', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = {
      fijado: false,
      eventos: [
        { id: 'ev-1', tipo: 'invalidado_por_vinculo', usuarioNombre: 'Bruno', creadoEl: '2026-08-10T12:00:00.000Z' },
      ],
    }

    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Tu PIN quedó sin efecto al vincular esta cuenta (Bruno,')
    expect(texto).not.toContain('Bruno invalidó tu PIN')
    expect(texto).not.toMatch(/\.\./)
  })

  // El fallback de `usuarioNombre === null` (la cuenta que hizo el cambio ya
  // se dio de baja) tiene que decir lo mismo que `PinEventosLista.vue` para
  // el mismo dato — no inventar un rol ("el encargado") que ya no respalda.
  it('si la cuenta que invalidó ya se dio de baja, dice "Una cuenta dada de baja", no "El encargado"', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = {
      fijado: false,
      eventos: [
        { id: 'ev-1', tipo: 'invalidado_por_encargado', usuarioNombre: null, creadoEl: '2026-08-10T12:00:00.000Z' },
      ],
    }

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Una cuenta dada de baja invalidó tu PIN')
    expect(wrapper.text()).not.toContain('El encargado invalidó')
  })

  it('sin ningún evento de invalidación (recién dado de alta), avisa el genérico "todavía no tenés PIN" y que no bloquea', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = { fijado: false, eventos: [] }

    const wrapper = await montar()

    expect(wrapper.text()).toContain(
      'Todavía no tenés PIN. Desde este dispositivo trabajás normal; para el tótem compartido, hace falta ponerlo desde tu perfil.',
    )
  })

  // El aviso no depende de que existan salones — vive fuera de esa rama del
  // template a propósito.
  it('avisa aunque el tenant no tenga ningún salón configurado', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = { fijado: false, eventos: [] }
    salonesMock = []

    const wrapper = await montar()

    expect(wrapper.text()).toContain('No hay salones configurados')
    expect(wrapper.text()).toContain('Todavía no tenés PIN')
  })

  // Contraejemplo del mutante "el aviso también con fijado: true": con el PIN
  // ya puesto no hay nada que avisar, aunque el historial conserve un evento
  // de invalidación viejo (el garzón ya se puso uno nuevo después de ese
  // evento). La condición es el ESTADO, no la presencia de eventos viejos.
  it('con el PIN ya fijado, no avisa aunque el historial tenga una invalidación vieja', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinMock = {
      fijado: true,
      eventos: [
        { id: 'ev-1', tipo: 'invalidado_por_encargado', usuarioNombre: 'Bruno', creadoEl: '2026-08-10T12:00:00.000Z' },
      ],
    }

    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('invalidó tu PIN')
    expect(wrapper.text()).not.toContain('Todavía no tenés PIN')
    expect(botonPerfilEnAviso(wrapper)).toBeUndefined()
  })

  // Un tótem compartido no tiene "mi PIN": sin vínculo el aviso no puede
  // aparecer, ni siquiera si el backend (por lo que sea) devolviera un estado
  // sin fijar para la cuenta que está logueada en el dispositivo.
  it('en el tótem compartido (sin vínculo) el aviso nunca aparece', async () => {
    vinculoPersonal = null
    miPinMock = { fijado: false, eventos: [] }

    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Todavía no tenés PIN')
    expect(botonPerfilEnAviso(wrapper)).toBeUndefined()
  })

  // El mutante obligatorio del `.catch`: sacarlo deja que el rechazo de
  // `miPin()` voltee el `Promise.all` entero, y todo lo que se asigna
  // DESPUÉS —incluido `garzonPersonal`— nunca corre. La cuenta sigue
  // vinculada según el backend (`vinculoPersonal`), pero la pantalla vuelve a
  // pedir PIN por teclado como si fuera un dispositivo compartido: mismo bug
  // documentado arriba para `miVinculo`/`caja/activa`, esta vez en la llamada
  // nueva.
  it('un 404 de mi-pin no le pide PIN por teclado a quien SÍ tiene cuenta vinculada (el `.catch` no es opcional)', async () => {
    vinculoPersonal = { garzonId: 'g1', nombre: 'Ana' }
    miPinRechaza = true

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    const boton = botonEn(drawerMesa(), 'Nueva cuenta')
    expect(boton).toBeTruthy()
    boton!.click()
    await esperar(30)

    // Sin teclado: el modal de PIN no llegó a existir porque el modo personal
    // se activó igual — la prueba de que `garzonPersonal` SÍ se terminó de
    // asignar pese al 404 de `miPin()`.
    expect(tecladoPin()).toBeUndefined()
    expect(postsAbrirCuenta).toHaveLength(1)
  })
})

/**
 * El catálogo del salón muestra **lo que el servidor dejó disponible**.
 *
 * Desde el 2026-09-01 `GET /items` devuelve `stockDisponible` (producto e
 * ingrediente) y `disponible` (receta y combo) ya restados de todo lo que las
 * cuentas ABIERTAS del tenant pidieron — las de esta mesa incluidas—. Esta
 * pantalla, que hasta entonces mantenía el número con `descontarStockCatalogo`,
 * tuvo que dejar de hacerlo: restar de nuevo las líneas de la mesa las contaba
 * dos veces y dejaba en 0 —tarjeta gris, click bloqueado, sin ningún mensaje—
 * un producto del que todavía quedaban unidades.
 *
 * El mutante que estos tests tienen que matar es justamente el código anterior:
 * `descontarStockCatalogo(items.value, líneas de las cuentas)`. Con un producto
 * de `stock: 3` que la mesa ya pidió 2 veces, el servidor manda
 * `stockDisponible: 1` y ese mutante lo deja en **-1**.
 */
describe('salones — el catálogo no vuelve a descontar lo que el servidor ya apartó', () => {
  const PRODUCTO_ID = 'item-coca'

  /** Producto con las dos magnitudes distintas: 3 en la bodega, 1 pedible. */
  function producto(stock: string, stockDisponible: string | null) {
    return {
      id: PRODUCTO_ID,
      nombre: 'Coca-Cola',
      descripcion: null,
      precioBase: '1500',
      monedaId: CLP_ID,
      monedaSimbolo: '$',
      stock,
      stockDisponible,
      unidadMedida: 'unidad',
      tipo: 'producto',
      activo: true,
      disponible: null,
    }
  }

  /** Una cuenta abierta con `cantidad` unidades del producto ya pedidas. */
  function cuentaConPedido(cantidad: string) {
    return {
      id: 'cuenta-9',
      numero: 9,
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
      lineas: [{
        id: 'linea-1',
        itemId: PRODUCTO_ID,
        nombre: 'Coca-Cola',
        precioBase: '1500',
        monedaId: CLP_ID,
        cantidad,
      }],
    }
  }

  /** Selecciona la mesa y entra a su única cuenta: la grilla vive ahí adentro. */
  async function abrirLaCuenta(wrapper: Awaited<ReturnType<typeof montar>>) {
    await seleccionarMesa(wrapper)
    const tarjeta = drawerMesa()?.querySelector<HTMLElement>('.cursor-pointer')
    expect(tarjeta).toBeTruthy()
    tarjeta!.click()
    await esperar(20)
  }

  /** El texto de la tarjeta del producto en la grilla del catálogo. */
  function tarjetaDelProducto(): string {
    const tarjeta = drawerMesa()?.querySelector(`[data-qa="item-catalogo-${PRODUCTO_ID}"]`)
    return tarjeta?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }

  beforeEach(reiniciarMock)

  it('la mesa que ya pidió 2 ve el 1 que queda, no un descuento aplicado dos veces', async () => {
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('2')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)

    // El número del servidor, tal cual. Con el descuento local encima daría -1.
    expect(tarjetaDelProducto()).toContain('Disponible: 1')
    // Y sigue siendo clickeable: queda una unidad de verdad.
    expect(tarjetaDelProducto()).not.toContain('Disponible: -1')
  })

  it('muestra lo pedible y no el saldo de bodega: 3 en el kardex, 1 en la tarjeta', async () => {
    // El contraejemplo del de arriba: si la tarjeta leyera `stock` diría 3 —el
    // bug que este frente vino a cerrar— y el test de arriba pasaría igual con
    // `stockDisponible` ignorado.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('2')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)

    expect(tarjetaDelProducto()).not.toContain('Disponible: 3')
  })

  it('cambiar lo pedido vuelve a preguntarle al servidor, sin cambiar de mesa ni de cuenta', async () => {
    // La contraparte de haber sacado la aritmética local: si el número no se
    // recalcula, tiene que volver a pedirse. Y tiene que pedirse **por lo
    // pedido**, no solo por navegar.
    //
    // ⚠️ La aserción va sobre el conteo DESPUÉS de entrar a la cuenta y contra
    // un `agregarLinea` que no toca la mesa ni la cuenta activa. Un
    // `> alMontar` medido tras abrir la mesa no fijaba nada: la selección sola
    // ya lo cumplía, y el mutante que borra las líneas de la fuente del watch
    // —dejándola en `activeCuenta.id`— pasaba con la suite entera en verde.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('2')]

    const wrapper = await montar()
    expect(urlsCatalogo).toHaveLength(3)

    await abrirLaCuenta(wrapper)
    // El refresco sale con debounce (`REFRESCO_ITEMS_MS`), así que la espera es
    // mayor que él a propósito.
    await esperar(400)
    const trasEntrarALaCuenta = urlsCatalogo.length

    // Ahora lo único que cambia es lo pedido: mismo drawer, misma cuenta.
    const tarjeta = drawerMesa()?.querySelector<HTMLElement>(`[data-qa="item-catalogo-${PRODUCTO_ID}"]`)
    expect(tarjeta).toBeTruthy()
    tarjeta!.click()
    await esperar(400)

    expect(lineasAgregadas).toHaveLength(1)
    expect(urlsCatalogo.length).toBe(trasEntrarALaCuenta + 3)
    for (const url of urlsCatalogo) expect(url).toContain('activo=true')
  })

  it('una edición de cantidad a medio camino no dispara el refresco', async () => {
    // El orden importa y era determinista, no una carrera: `onCantidadChange`
    // pinta la cantidad en el acto y recién manda el PATCH 300 ms después, así
    // que el refresco salía a los 250 ms —ANTES del PATCH— y volvía con el
    // número viejo. Que casi siempre se curara era accidente de formato: el
    // optimista deja `'3'` y el servidor devuelve `'3.0000'`, así que la firma
    // del watch cambiaba de casualidad y disparaba un segundo refresco. Con una
    // cantidad que ya trae 4 decimales los dos strings coinciden y ese segundo
    // refresco no existía.
    //
    // ⚠️ **La otra mitad —que al confirmar el servidor SÍ salga el refresco— no
    // se afirma acá, y no es una omisión.** `patchLineaCantidad` hace
    // `structuredClone(activeCuenta.value)`, y `activeCuenta.value` es el Proxy
    // reactivo de un `ref`: ni Node ni Chrome clonan Proxies. Medido en Chrome
    // real (2026-09-01, `/salones` con una cuenta abierta): tira
    // `DataCloneError` ANTES de `inflight.add`, o sea que **el PATCH de cantidad
    // nunca se manda**. Es un bug preexistente y ajeno a este frente —ningún
    // test cubría ese camino, por eso nadie lo vio—. Mientras viva, el servidor
    // no confirma nada y el refresco posterior es un estado inalcanzable.
    //
    // Por eso el test saca la cuenta de pantalla antes de los 300 ms: así el
    // timer pendiente encuentra `activeCuenta` en `null`, corta antes del
    // `structuredClone` y la suite no arrastra un `unhandled rejection` ajeno
    // —que deja `vitest` en exit 1 aunque todos los tests pasen—.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('0.3333')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)
    const antesDeEditar = urlsCatalogo.length
    const calculosAntes = calculosPedidos.length

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(input).toBeTruthy()
    input!.vm.$emit('change', {
      presentacion: '0.6666',
      unidadCodigo: 'unidad',
      cantidadCanonica: '0.6666',
    })

    // Un tick: alcanza para que el watch corra con la cuenta TODAVÍA abierta,
    // que es la condición que hace falta para estar probando el guard de la
    // edición pendiente y no el de "la grilla está en pantalla".
    await esperar(10)
    // Y el pintado optimista ocurrió de verdad (`patchLineaOptimista`
    // recalcula): sin esta aserción el test pasaría por no haber hecho nada,
    // que es la forma barata de un falso verde.
    expect(calculosPedidos.length).toBeGreaterThan(calculosAntes)

    botonEn(drawerMesa(), 'Cuentas')?.click()
    await esperar(600)

    // En toda la ventana no salió ni un GET de catálogo, aunque la firma del
    // watch sí cambió: la línea editada sale de ella mientras está pendiente.
    expect(urlsCatalogo.length).toBe(antesDeEditar)
  })

  it('un refresco que falla deja la grilla como estaba, no la vacía', async () => {
    // Mientras el catálogo se pedía UNA vez en `onMounted`, un blip de red no
    // lo podía borrar. Ahora se pide muchas veces por turno: asignar
    // `?.data ?? []` a ciegas dejaba al garzón con "No hay ítems para mostrar"
    // a mitad de servicio por un corte de dos segundos, sin aviso y sin nada
    // que reintentara. El refresco conserva lo que ya estaba.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('2')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)
    expect(tarjetaDelProducto()).toContain('Disponible: 1')

    // Se corta la red y se dispara un refresco.
    catalogoRechaza403 = true
    const tarjeta = drawerMesa()?.querySelector<HTMLElement>(`[data-qa="item-catalogo-${PRODUCTO_ID}"]`)
    tarjeta!.click()
    await esperar(400)

    expect(tarjetaDelProducto()).toContain('Disponible: 1')
    expect(drawerMesa()?.textContent).not.toContain('No hay ítems para mostrar')
  })

  it('pasear por las mesas sin entrar a una cuenta no pide el catálogo', async () => {
    // La grilla solo existe en la rama de detalle de cuenta. Sin este guard,
    // seis mesas miradas de paso eran 18 GET `/items` para no mostrar nada.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('2')]

    const wrapper = await montar()
    expect(urlsCatalogo).toHaveLength(3)

    await seleccionarMesa(wrapper)
    await esperar(400)

    expect(urlsCatalogo).toHaveLength(3)
  })
})
