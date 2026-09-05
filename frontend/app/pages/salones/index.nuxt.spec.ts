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
let patchCantidadFalla = false
/**
 * Retiene la respuesta del `PATCH` de cantidad hasta que el test la suelte —
 * mismo patrón que `abrirCuentaRetenido`. Es lo único que abre la ventana
 * "`PATCH` en vuelo": sin esto el mock contesta en el mismo microtask y esa
 * ventana no existe.
 */
let patchCantidadRetenido: Promise<void> | null = null
/**
 * `POST /cuentas/:id/cancelar` rechaza. Es el caso real: otro dispositivo ya
 * cerró la cuenta y el backend contesta `400 La cuenta no está abierta`
 * (`salones.service.ts`, `getCuentaAbiertaConLock`).
 */
let cancelarFalla = false
/** Ver el mock de `POST /cuentas/:id/cancelar`. */
let patchesAlCancelar = -1
/** Gemelo del anterior, para `POST /mesas/:id/cuentas/fusionar`. */
let patchesAlFusionar = -1
let fusionesPedidas = 0
/** Los `cuentaIds` con los que salió la fusión: lo que el garzón pidió, no lo
 *  que la pantalla tenga seleccionado cuando el request sale. */
let cuentasFusionadas: string[] = []
/** Retiene el `POST /mesas/:id/cuentas/fusionar`: la fusión que aterriza tarde. */
let fusionRetenida: Promise<void> | null = null
/**
 * Lo que devuelve `GET /impresoras?rol=comanda`. Vacío por defecto: sin ninguna
 * activa, `imprimirComanda()` se saltea el flujo entero —ni reclama ni imprime—
 * y devuelve `null`, así que los tests que no hablan de comanda no se enteran.
 */
let impresorasComanda: unknown[] = []
/**
 * Cada `POST /cuentas/:id/comanda/reclamar`, con el id que viajó en la URL.
 *
 * Es LA señal de que la comanda salió a cocina, y de cuál cuenta: ese claim es
 * lo que avanza `cantidad_enviada` en el backend. Se guarda el id y no un
 * contador porque el agujero que estos tests fijan no es solo "no salió", sino
 * "salió la de otra cuenta".
 */
let reclamosDeComanda: string[] = []
/**
 * Cada `POST /cuentas/:id/cerrar`, con el id que viajó en la URL.
 *
 * Es la prueba de que el cobro que el garzón ya confirmó **con su PIN** salió, y
 * de qué cuenta cobró. Igual que con la comanda, el agujero no es solo "no
 * salió": es "cerró la otra".
 */
let cierresDeCuenta: string[] = []
/** El body de cada uno: con qué propina se cerró. Ver el test de la propina. */
let bodiesDeCierre: Record<string, unknown>[] = []
/**
 * Retiene el `POST /cuentas/:id/lineas`, igual que `abrirCuentaRetenido`. Es lo
 * que abre la ventana "agregué un producto y me fui": sin esto el mock contesta
 * en el mismo microtask.
 */
let agregarLineaRetenido: Promise<void> | null = null
/**
 * Lo que devuelve `GET /mesas/:id/cuentas` **por mesa**. Sin entrada, cae en
 * `cuentasDeLaMesa` — el fixture único que usan casi todos los tests—. Con
 * entrada, cada mesa tiene lo suyo, que es lo único que permite ver de qué mesa
 * es la lista que quedó en pantalla.
 */
let cuentasPorMesa: Record<string, unknown[]> = {}
/** Retiene ese `GET` **por mesa**: la carrera de dos mesas necesita frenar una sola. */
let listarCuentasRetenido: Record<string, Promise<void>> = {}
/**
 * Lo que devuelve `GET /garzones` —la lista completa que carga el modal de
 * transferencia, distinta del `/garzones/para-selector` del PIN—. Dos garzones
 * a propósito: `garzonesTransferibles` saca al responsable de la cuenta, así que
 * con uno solo la lista quedaría vacía y el botón *Confirmar* deshabilitado, o
 * sea que el test no podría llegar a la conducta que fija.
 */
let garzonesLista: unknown[] = []
/** Retiene ese `GET`: es la ventana en la que el modal se abre "a destiempo". */
let listarGarzonesRetenido: Promise<void> | null = null
/** Cada `POST /cuentas/:id/transferir-admin`, con el id que viajó en la URL. */
let transferenciasAdmin: string[] = []
/**
 * Estado del **servidor** para las cuentas de la mesa, separado del fixture.
 *
 * Sin esto, servidor y pantalla son EL MISMO objeto: el `GET` devuelve
 * `cuentasDeLaMesa` tal cual, la página se lo queda en `cuentas.value` y el
 * pintado optimista escribe adentro del fixture (`cuentas.value[idx] = patched`,
 * sobre el array que el mock devolvió). Con eso, la respuesta de cualquier
 * `PATCH` ya trae lo que la pantalla pintó y **ningún test puede distinguir "lo
 * que el servidor tiene" de "lo que la pantalla cree"** — que es exactamente la
 * diferencia que el flush de varias líneas se comía.
 *
 * Se clona en el primer `GET`, antes de que la pantalla toque nada, y cada
 * `PATCH` lo persiste. El `GET` sigue devolviendo el fixture tal cual: separar
 * también esa mitad no hace falta acá y movería el piso de los otros tests.
 */
let cuentasServidor: { lineas: { id: string, cantidad: string }[] }[] | null = null
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
let toasts: { title?: string, description?: string, color?: string }[] = []

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

    const mesaCuentas = ruta.match(/\/mesas\/([^/]+)\/cuentas$/)
    if (mesaCuentas) {
      const mesaPedida = mesaCuentas[1] ?? ''
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
      // El snapshot del servidor se toma acá, en el primer `GET`: es el único
      // momento en que el fixture todavía no pasó por la pantalla.
      cuentasServidor ??= structuredClone(cuentasDeLaMesa) as NonNullable<typeof cuentasServidor>
      const lista = cuentasPorMesa[mesaPedida] ?? cuentasDeLaMesa
      const retenido = listarCuentasRetenido[mesaPedida]
      return retenido ? retenido.then(() => lista) : Promise.resolve(lista)
    }

    // `POST /cuentas/:id/lineas` — agregar un ítem a la cuenta abierta. Lo usa
    // el describe de la disponibilidad: es la única forma de mover lo pedido
    // SIN cambiar de mesa ni de cuenta, que es la conducta que ahí se fija.
    // Devuelve la cuenta con la línea nueva, como el backend.
    if (/\/cuentas\/[^/]+\/lineas$/.test(ruta) && method === 'POST') {
      const body = (opts?.body ?? {}) as { itemId?: string, cantidad?: string }
      lineasAgregadas.push(body)
      const cuenta = cuentasDeLaMesa[0] as { lineas: unknown[] }
      const conLinea = {
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
      }
      return agregarLineaRetenido
        ? agregarLineaRetenido.then(() => conLinea)
        : Promise.resolve(conLinea)
    }

    // `PATCH /cuentas/:id/lineas/:lineaId` — cambiar la cantidad de una línea.
    // Devuelve la cantidad **tal cual la mandó el cliente**, que es el caso que
    // interesa: cuando el eco del servidor coincide string a string con lo que
    // el optimista ya pintó, la firma del watch no cambia por formato.
    const patchLinea = ruta.match(/\/cuentas\/[^/]+\/lineas\/([^/]+)$/)
    if (patchLinea && method === 'PATCH') {
      const body = (opts?.body ?? {}) as { cantidad?: string }
      patchesDeCantidad.push({ lineaId: patchLinea[1] ?? '', cantidad: body.cantidad ?? '' })
      const responder = () => {
        // El 400 del tope de stock de `actualizarLinea`, que hasta el 2026-09-02
        // era inalcanzable desde la pantalla.
        if (patchCantidadFalla) {
          return Promise.reject(new Error('Stock insuficiente de "Carne": quedan 1 unidad'))
        }
        const cuenta = cuentasServidor?.[0]
        // Falla ruidosa a propósito: un `PATCH` sin `GET` previo es un test mal
        // armado, y un fallback silencioso al fixture devolvería justo el estado
        // compartido con la pantalla que este mock vino a separar.
        if (!cuenta) return Promise.reject(new Error('PATCH sin GET previo de cuentas'))
        cuenta.lineas = cuenta.lineas.map(l =>
          l.id === patchLinea[1] ? { ...l, cantidad: body.cantidad ?? l.cantidad } : l,
        )
        return Promise.resolve(structuredClone(cuenta))
      }
      // Sin retención contesta de una, como en producción; con retención el test
      // decide cuándo, y ahí es donde vive la ventana del `PATCH` en vuelo.
      return patchCantidadRetenido ? patchCantidadRetenido.then(responder) : responder()
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
    const transferAdminMatch = ruta.match(/\/cuentas\/([^/]+)\/transferir-admin$/)
    if (transferAdminMatch) {
      transferenciasAdmin.push(transferAdminMatch[1] ?? '')
      return Promise.resolve({ id: transferAdminMatch[1], lineas: [] })
    }
    if (ruta.endsWith('/garzones')) {
      return listarGarzonesRetenido
        ? listarGarzonesRetenido.then(() => garzonesLista)
        : Promise.resolve(garzonesLista)
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
    if (/\/cuentas\/[^/]+\/cancelar$/.test(ruta)) {
      // Cuántas ediciones habían salido ya cuando llegó el cancelar. Es la única
      // forma de afirmar el ORDEN: los dos requests terminan igual, y con
      // `patchesDeCantidad` leído al final no se distingue "salió antes" de
      // "salió después".
      patchesAlCancelar = patchesDeCantidad.length
      if (cancelarFalla) return Promise.reject(new Error('La cuenta no está abierta'))
      return Promise.resolve({ ok: true })
    }
    if (ruta.endsWith('/cuentas/fusionar')) {
      fusionesPedidas++
      patchesAlFusionar = patchesDeCantidad.length
      cuentasFusionadas = (opts?.body as { cuentaIds?: string[] } | undefined)?.cuentaIds ?? []
      const fusionada = { ...(cuentasDeLaMesa[0] as object), numero: 1 }
      return fusionRetenida ? fusionRetenida.then(() => fusionada) : Promise.resolve(fusionada)
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
    const cerrarMatch = ruta.match(/\/cuentas\/([^/]+)\/cerrar$/)
    if (cerrarMatch) {
      cierresDeCuenta.push(cerrarMatch[1] ?? '')
      bodiesDeCierre.push(opts?.body ?? {})
      // La pantalla descarta la respuesta; lo que importa es que el POST salió.
      return Promise.resolve({ cuenta: null, ventaId: 'venta-1' })
    }
    if (ruta.endsWith('/impresoras')) {
      // La URL **entera**, como en `/items`: `listar()` manda el rol por query
      // y `obtenerImpresoraBoleta()` NO vuelve a filtrarlo del lado del
      // cliente, así que un mock que ignore el `?rol=` haría pasar una
      // impresora de comanda por impresora de boleta.
      return Promise.resolve(url.includes('rol=comanda') ? impresorasComanda : [])
    }
    const reclamarMatch = ruta.match(/\/cuentas\/([^/]+)\/comanda\/reclamar$/)
    if (reclamarMatch) {
      reclamosDeComanda.push(reclamarMatch[1] ?? '')
      // Sin estaciones pendientes: `imprimirComanda()` corta ahí (`useImpresoras.ts`)
      // y no entra a `imprimirEn()`, que importa el cliente real de `qz-tray` y le
      // pide un `websocket.connect()` a QZ Tray en localhost — no hay ninguno
      // corriendo en un test. Alcanza igual: lo que estos tests miden es que el
      // claim salió y con qué cuenta.
      return Promise.resolve({ estaciones: [] })
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
  patchCantidadFalla = false
  patchCantidadRetenido = null
  cancelarFalla = false
  patchesAlCancelar = -1
  patchesAlFusionar = -1
  fusionesPedidas = 0
  cuentasFusionadas = []
  fusionRetenida = null
  impresorasComanda = []
  reclamosDeComanda = []
  cierresDeCuenta = []
  bodiesDeCierre = []
  agregarLineaRetenido = null
  cuentasPorMesa = {}
  listarCuentasRetenido = {}
  garzonesLista = []
  listarGarzonesRetenido = null
  transferenciasAdmin = []
  cuentasServidor = null
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
  // El store de permisos también sobrevive entre tests. **Sacar esta línea hoy no
  // rompe nada —medido—, pero NO porque no corra nada después**: dos tests
  // corren después de uno que prende `esAdmin` (los de abrir cuenta) y pasan
  // igual, porque ninguno mira el botón *Transferir*. O sea que hoy hay tests
  // corriendo con el store contaminado y en verde por casualidad, no por orden.
  // El reset es lo que hace que el día que uno de ellos afirme sobre el listado
  // no aparezca un falso verde. Lo corrigió la revisión: la primera versión de
  // este comentario decía que eran los últimos del archivo, y es falso.
  usePermissionsStore().reset()
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

  /**
   * Una TERCERA cuenta, con su línea, que **no entra en la fusión**. Sin ella no
   * se puede montar la escena de "el garzón se metió en otra cuenta": con solo
   * dos, la otra es siempre una de las fusionadas —y ahí lo correcto es
   * justamente lo contrario, llevarlo a la fusionada—.
   */
  function terceraCuentaConPedido(cantidad: string) {
    return {
      ...segundaCuenta(),
      id: 'cuenta-11',
      numero: 11,
      lineas: [{
        id: 'linea-3',
        itemId: PRODUCTO_ID,
        nombre: 'Coca-Cola',
        precioBase: '1500',
        monedaId: CLP_ID,
        cantidad,
      }],
    }
  }

  /** Gemela de `segundaCuenta` pero CON línea propia: hace falta para editar en
   *  la otra cuenta mientras el cancelar de la primera viaja. */
  function otraCuentaConPedido(cantidad: string) {
    return {
      ...segundaCuenta(),
      lineas: [{
        id: 'linea-2',
        itemId: PRODUCTO_ID,
        nombre: 'Coca-Cola',
        precioBase: '1500',
        monedaId: CLP_ID,
        cantidad,
      }],
    }
  }

  /**
   * La segunda cuenta de la mesa: sin dos, el botón *Fusionar cuentas* ni
   * siquiera se rinde (`v-if="cuentas.length >= 2"`). Va SIN líneas a propósito
   * —lo que se fusiona acá es el orden de dos requests, no el contenido—.
   */
  function segundaCuenta() {
    return {
      id: 'cuenta-10',
      numero: 10,
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
  }

  /**
   * La misma cuenta con **dos** líneas. Hace falta una segunda para el flush:
   * el agujero que fija ese test es que la respuesta del `PATCH` de la primera
   * pisa el optimista de la que todavía está pendiente, y con una sola línea no
   * hay nada que pisar.
   */
  function cuentaConDosPedidos() {
    const base = cuentaConPedido('1.0000')
    return {
      ...base,
      lineas: [
        ...base.lineas,
        {
          id: 'linea-2',
          itemId: 'item-papas',
          nombre: 'Papas fritas',
          precioBase: '2000',
          monedaId: CLP_ID,
          cantidad: '2.0000',
        },
      ],
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

  it('cuando el servidor confirma la cantidad, el catálogo se vuelve a pedir', async () => {
    // La mitad que la Tarea 8 no pudo afirmar porque el PATCH nunca salía. El
    // guard frena el refresco MIENTRAS la edición está pendiente; una vez que el
    // servidor confirma, el catálogo tiene que volver a pedirse — si no, el
    // disponible que ve el garzón se queda con el número de antes de su cambio.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)
    const antesDeEditar = urlsCatalogo.length

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    await esperar(600)

    expect(patchesDeCantidad).toHaveLength(1)
    expect(urlsCatalogo.length).toBe(antesDeEditar + 3)
  })

  it('cambiar la cantidad de una línea MANDA el PATCH al servidor', async () => {
    // Existía `patchesDeCantidad` —el mock lo llenaba y se reseteaba entre
    // tests— y **nadie lo afirmaba nunca**. Por eso `patchLineaCantidad` pudo
    // pasar un mes y medio sin mandar un solo PATCH: `structuredClone` sobre el
    // Proxy reactivo de `activeCuenta` tira `DataCloneError` antes de llamar a
    // la API, y como estaba fuera del `try`, el error no salía ni por el toast.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(input).toBeTruthy()
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(400)

    expect(patchesDeCantidad).toHaveLength(1)
    expect(patchesDeCantidad[0]!.cantidad).toBe('3.0000')
  })

  it('si el servidor rechaza la cantidad, avisa y deja de mostrar la que no se guardó', async () => {
    // La otra mitad del mismo camino muerto: el `catch` que hace rollback y
    // avisa tampoco corría nunca. Con el tope de stock de `actualizarLinea` ya
    // construido, éste es el caso real — el garzón sube a 3 y el servidor dice
    // que quedaba 1.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    patchCantidadFalla = true

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(400)

    expect(patchesDeCantidad).toHaveLength(1)
    expect(toasts.some(t => /Stock insuficiente/.test(t.title ?? ''))).toBe(true)
    expect(toasts.find(t => /Stock insuficiente/.test(t.title ?? ''))?.color).toBe('error')
    // Y la cantidad vuelve a la que el servidor tiene, no queda pintada la que
    // no se guardó.
    //
    // ⚠️ Se afirma sobre el `model-value` del input, NO sobre `wrapper.text()`:
    // el texto muestra la PRESENTACIÓN (`3`) y no la canónica (`3.0000`), así
    // que un `not.toContain('3.0000')` pasa con y sin rollback. Medido con el
    // mutante que borra el `syncCuenta(snapshot)` del `catch`: sobrevivía.
    const inputTrasFallar = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    // `'1.0000'` y no `'1'`: la línea del fixture no trae `cantidadPresentacion`,
    // así que la presentación cae a la canónica — y es exactamente lo que el
    // input mostraba ANTES de editar, que es lo que el rollback tiene que devolver.
    expect(inputTrasFallar!.props('modelValue')).toBe('1.0000')
  })

  it('dos ediciones seguidas: deshacer vuelve a lo que había ANTES de la primera', async () => {
    // El garzón corrige dos veces antes de que salga el PATCH (1 → 2 → 3) y el
    // servidor rechaza. Deshacer tiene que devolver a **1**, no a 2: el 2 nunca
    // se guardó tampoco. Por eso `previo` se toma solo en la primera edición de
    // la ráfaga — en la segunda la línea ya trae lo que pintó el optimista.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    patchCantidadFalla = true

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', { presentacion: '2', unidadCodigo: 'unidad', cantidadCanonica: '2.0000' })
    await esperar(50)
    input!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    await esperar(400)

    // Un solo PATCH, el del último valor: el debounce colapsa la ráfaga.
    expect(patchesDeCantidad).toHaveLength(1)
    expect(patchesDeCantidad[0]!.cantidad).toBe('3.0000')

    const tras = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(tras!.props('modelValue')).toBe('1.0000')
  })

  it('con el PATCH en vuelo, la segunda edición sigue deshaciendo hasta lo que el servidor tiene', async () => {
    // La misma ráfaga del test de arriba pero en una ventana más chica: la que
    // se abre entre que el timer del debounce dispara —y borra la entrada de
    // `pendingByLinea`— y el servidor contesta. Ahí ya no hay pendiente, así que
    // el `previo` se recalculaba **desde la línea**, que trae el optimista sin
    // confirmar: con las dos respuestas rechazadas quedaba pintado un 2 que el
    // servidor nunca aceptó. No son 300 ms de margen sino la latencia de la red,
    // que es donde el garzón corrige de verdad.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    patchCantidadFalla = true
    let soltarServidor: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarServidor = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const primero = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    primero!.vm.$emit('change', { presentacion: '2', unidadCodigo: 'unidad', cantidadCanonica: '2.0000' })
    // 400 > 300: el timer ya disparó y el PATCH del 2 está EN VUELO, retenido.
    await esperar(400)
    expect(patchesDeCantidad).toHaveLength(1)

    const enVuelo = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    enVuelo!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    await esperar(20)
    soltarServidor()
    await esperar(500)

    // Los dos salieron y los dos los rechazó el servidor.
    expect(patchesDeCantidad.map(p => p.cantidad)).toEqual(['2.0000', '3.0000'])
    // Y la pantalla vuelve a **1**, la única cantidad que el servidor confirmó
    // alguna vez. Con el `previo` recalculado desde la línea acá quedaba `'2'`.
    const tras2 = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(tras2!.props('modelValue')).toBe('1.0000')
  })

  it('si el PATCH de la ráfaga sale BIEN, deshacer el siguiente vuelve a lo que el servidor confirmó', async () => {
    // La gemela del test de arriba con una sola diferencia, que es la que
    // importa: el primer `PATCH` **lo acepta el servidor**. Ahí el `previo` que
    // `onCantidadChange` guardó —el de antes de la ráfaga— dejó de ser "lo
    // último que el servidor confirmó", y deshacer el rechazo posterior devolvía
    // la línea más atrás de lo que corresponde.
    //
    // Medido el 2026-09-02 con una sonda sobre `cuentasServidor`: tras el 2
    // aceptado los dos decían `2.0000`; tras el 3 rechazado la pantalla quedaba
    // en `1.0000` y el servidor en `2.0000`. Y **no se autocorregía**: la única
    // lectura de `GET /cuentas` es `onSelectMesa`, así que el número equivocado
    // sobrevivía a salir de la cuenta y volver a entrar desde el listado.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltarServidor: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarServidor = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const primero = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    primero!.vm.$emit('change', { presentacion: '2', unidadCodigo: 'unidad', cantidadCanonica: '2.0000' })
    // 400 > 300: el timer ya disparó y el PATCH del 2 está EN VUELO, retenido.
    await esperar(400)
    expect(patchesDeCantidad).toHaveLength(1)

    const enVuelo = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    enVuelo!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    await esperar(20)

    // El segundo ya no se retiene, y el primero se suelta **aceptado**.
    patchCantidadRetenido = null
    soltarServidor()
    await esperar(20)
    // Recién ahora el servidor empieza a rechazar: si se prendiera antes, el
    // `responder` del primero leería el flag y este test sería el de arriba.
    expect(cuentasServidor![0]!.lineas[0]!.cantidad).toBe('2.0000')
    patchCantidadFalla = true
    await esperar(500)

    // Los dos salieron; el 2 quedó guardado y el 3 rebotó.
    expect(patchesDeCantidad.map(p => p.cantidad)).toEqual(['2.0000', '3.0000'])
    expect(cuentasServidor![0]!.lineas[0]!.cantidad).toBe('2.0000')
    // Y la pantalla queda en **2**, no en el 1 de antes de la ráfaga: deshacer
    // devuelve a lo último que el servidor confirmó, que ya no es lo que había
    // cuando el garzón empezó a tocar.
    const tras = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(tras!.props('modelValue')).toBe('2.0000')
  })

  it('con DOS PATCH en vuelo, el que rebota deshace hasta lo que confirmó el otro', async () => {
    // **La segunda ventana del mismo bug, y la que el primer arreglo no vio.**
    // La de arriba vive dentro de los 300 ms del debounce: cuando el servidor
    // contesta, la segunda edición todavía es una entrada de `pendingByLinea` y
    // re-tasarle el `previo` alcanza. Con la latencia POR ENCIMA de los 300 ms
    // —la tablet con wifi de restaurante— el timer de la segunda ya disparó,
    // así que el Map está vacío y hay **dos `PATCH` en vuelo sobre la misma
    // línea**: el segundo quedaba cerrado sobre el `previo` de antes de la
    // ráfaga y deshacía hasta ahí.
    //
    // Medido por la revisión independiente del diff que cerró la ventana de
    // arriba: pantalla `1.0000`, servidor `2.0000` — la misma escena que ese
    // arreglo declaraba cerrada.
    //
    // Las dos retenciones son promesas DISTINTAS a propósito: con una sola
    // compartida los dos requests se sueltan juntos y no se puede aceptar el
    // primero y rechazar el segundo, que es lo único que arma la escena.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltarPrimero: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarPrimero = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const primero = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    primero!.vm.$emit('change', { presentacion: '2', unidadCodigo: 'unidad', cantidadCanonica: '2.0000' })
    await esperar(400)
    expect(patchesDeCantidad).toHaveLength(1)

    // El segundo tap, con su propia retención: así su timer puede disparar
    // mientras el primero SIGUE en vuelo.
    let soltarSegundo: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarSegundo = r
    })
    const enVuelo = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    enVuelo!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    // 400 > 300: el timer del segundo YA disparó, así que `pendingByLinea` está
    // vacío y los dos requests están en vuelo a la vez.
    await esperar(400)
    expect(patchesDeCantidad).toHaveLength(2)

    // El primero se acepta…
    soltarPrimero()
    await esperar(20)
    expect(cuentasServidor![0]!.lineas[0]!.cantidad).toBe('2.0000')
    // …y recién ahora el servidor empieza a rechazar, para que el segundo sea
    // el único que rebota.
    patchCantidadFalla = true
    soltarSegundo()
    await esperar(300)

    expect(patchesDeCantidad.map(p => p.cantidad)).toEqual(['2.0000', '3.0000'])
    expect(cuentasServidor![0]!.lineas[0]!.cantidad).toBe('2.0000')
    // La pantalla queda en 2, no en el 1 de antes de la ráfaga.
    const tras = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(tras!.props('modelValue')).toBe('2.0000')
  })

  it('el tap que llega a mitad del flush sale, y sale una sola vez', async () => {
    // **La ventana que abre el propio flush.** `flushPendientes` fotografía las
    // entradas y cancela ESOS timers antes del primer `await`; después recorre
    // las líneas de a una, esperando cada `PATCH`. Durante esa espera el garzón
    // puede volver a tocar una línea que el loop todavía no atendió:
    // `onCantidadChange` reemplaza la entrada y arma un timer nuevo, que el
    // `clearTimeout` de arriba —hecho sobre la foto— no alcanzó.
    //
    // ⚠️ Este test entró con el arreglo del `previo`, porque ese arreglo lo
    // rompió: desde que el timer relee el `Map`, el timer huérfano encontraba
    // la entrada ya borrada por el loop y **el tap se perdía en silencio**. Lo
    // cazó la revisión independiente. Antes de ese arreglo el tap salía igual,
    // pero en un `PATCH` de más.
    //
    // Se afirma sobre el **servidor**, no sobre la pantalla: lo que estaba mal
    // era que la comanda saliera con un número que el garzón ya había
    // cambiado.
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConDosPedidos()]
    let soltarPrimera: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarPrimera = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const inputs = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    expect(inputs).toHaveLength(2)
    inputs[0]!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    inputs[1]!.vm.$emit('change', { presentacion: '5', unidadCodigo: 'unidad', cantidadCanonica: '5.0000' })
    await esperar(20)
    expect(patchesDeCantidad).toHaveLength(0)

    const enviar = botonEn(drawerMesa(), 'Enviar a cocina')
    expect(enviar).toBeTruthy()
    enviar!.click()
    // El `PATCH` de la PRIMERA línea queda retenido, así que el loop está
    // parado en su `await` y la segunda todavía no salió.
    await esperar(50)
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])

    // Y ahí el garzón corrige la segunda línea. 400 > 300, así que si su timer
    // quedara vivo tendría tiempo de disparar por su cuenta.
    const enMedio = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    enMedio[1]!.vm.$emit('change', { presentacion: '7', unidadCodigo: 'unidad', cantidadCanonica: '7.0000' })
    patchCantidadRetenido = null
    soltarPrimera()
    await esperar(600)

    // El 7 llegó al servidor…
    expect(cuentasServidor![0]!.lineas[1]!.cantidad).toBe('7.0000')
    // …y salió UNA sola vez: ni el 5 viejo después del 7, ni un `PATCH` de más
    // del timer huérfano.
    expect(patchesDeCantidad).toEqual([
      { lineaId: 'linea-1', cantidad: '3.0000' },
      { lineaId: 'linea-2', cantidad: '7.0000' },
    ])
  })

  it('si el timer del tap dispara durante el flush, el flush no lo pisa con lo viejo', async () => {
    // **La hermana del test de arriba, con la latencia por encima del
    // debounce**, que es la premisa de todo este arreglo. Ahí el tap de mitad
    // del flush no espera al loop: su propio timer de 300 ms dispara primero y
    // manda el `PATCH` bueno. El loop llega después, encuentra la entrada ya
    // consumida… y mandaba **la foto**, o sea el valor de antes del tap,
    // pisando lo nuevo.
    //
    // Medido por la revisión independiente sobre este mismo harness:
    // `[linea-1:3, linea-2:7, linea-2:5]`, servidor y pantalla en 5 con el
    // garzón habiendo puesto 7, sin ningún toast — y `enviarComanda` imprime
    // justo después del flush.
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConDosPedidos()]
    let soltarPrimera: () => void = () => {}
    patchCantidadRetenido = new Promise<void>((r) => {
      soltarPrimera = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const inputs = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    inputs[0]!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    inputs[1]!.vm.$emit('change', { presentacion: '5', unidadCodigo: 'unidad', cantidadCanonica: '5.0000' })
    await esperar(20)

    const enviar = botonEn(drawerMesa(), 'Enviar a cocina')
    enviar!.click()
    await esperar(50)
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])

    const enMedio = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    enMedio[1]!.vm.$emit('change', { presentacion: '7', unidadCodigo: 'unidad', cantidadCanonica: '7.0000' })
    // **La diferencia con el test de arriba, y la única**: se dejan pasar los
    // 300 ms ANTES de soltar la primera retención, así que el timer del tap
    // dispara solo y el loop llega a una entrada que ya no está.
    patchCantidadRetenido = null
    await esperar(400)
    soltarPrimera()
    await esperar(600)

    // El 7 salió una sola vez y nada lo pisó después.
    expect(patchesDeCantidad).toEqual([
      { lineaId: 'linea-1', cantidad: '3.0000' },
      { lineaId: 'linea-2', cantidad: '7.0000' },
    ])
    expect(cuentasServidor![0]!.lineas[1]!.cantidad).toBe('7.0000')
  })

  it('el flush manda lo que el garzón puso en CADA línea, no lo que devolvió el PATCH anterior', async () => {
    // "Enviar a cocina" dentro de los 300 ms: `flushPendientes` recorre las
    // líneas pendientes de a una y **espera** cada PATCH, y el camino feliz de
    // cada uno hace `syncCuenta` con la cuenta ENTERA del servidor — que trae la
    // otra línea con su valor persistido y pisa el optimista todavía pendiente.
    // Releyendo la pantalla en la iteración siguiente, el 5 del garzón se perdía
    // y la comanda salía con la cantidad vieja, sin ningún toast.
    //
    // ⚠️ Esto solo se ve con un estado de servidor **independiente** del de la
    // pantalla: ver el docblock de `cuentasServidor`.
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConDosPedidos()]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const inputs = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    expect(inputs).toHaveLength(2)
    inputs[0]!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    inputs[1]!.vm.$emit('change', { presentacion: '5', unidadCodigo: 'unidad', cantidadCanonica: '5.0000' })
    // Bien adentro de los 300 ms: los dos timers siguen pendientes cuando el
    // garzón aprieta el botón, que es la escena que importa.
    await esperar(20)
    expect(patchesDeCantidad).toHaveLength(0)

    const enviar = botonEn(drawerMesa(), 'Enviar a cocina')
    expect(enviar).toBeTruthy()
    enviar!.click()
    await esperar(500)

    expect(patchesDeCantidad).toEqual([
      { lineaId: 'linea-1', cantidad: '3.0000' },
      { lineaId: 'linea-2', cantidad: '5.0000' },
    ])
    const trasFlush = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    expect(trasFlush[1]!.props('modelValue')).toBe('5.0000')
  })

  it('salir de la cuenta manda la edición que quedó a medio camino', async () => {
    // La tercera ventana de la misma familia, y la única que quedó abierta
    // cuando se cerró el `PATCH` que no llegaba: el garzón cambia 1 → 3 y toca
    // *Cuentas* ANTES de los 300 ms. Hasta el 2026-09-02 no salía ningún PATCH
    // ni ningún toast, y al volver a entrar el input mostraba 3: la cantidad
    // quedaba pintada como guardada y el servidor seguía en 1.
    //
    // Decisión del owner: salir guarda.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    // Bien adentro de la ventana del debounce: si el test esperara los 300 ms
    // el PATCH saldría solo y no probaría nada de salir.
    await esperar(20)
    expect(patchesDeCantidad).toHaveLength(0)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    // ⚠️ **50 ms desde la edición, no 400.** Con 400 el test pasaba igual sin el
    // flush: el timer del debounce disparaba solo a los 300 y mandaba el PATCH
    // lo mismo, así que el mutante que le saca el flush a `salirDeCuenta`
    // sobrevivía. Salir tiene que mandarlo **en el acto** —si el garzón cierra
    // la pantalla en esa ventana no hay timer que valga—, y eso es lo que se
    // afirma acá.
    await esperar(30)

    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])
  })

  it('si el rechazo llega con el garzón ya afuera, el aviso dice de qué cuenta es y la cantidad se deshace', async () => {
    // La contra de que salir guarde, y el costo que la entrada del backlog
    // nombraba: el rechazo del tope de stock puede llegar con la pantalla ya en
    // el listado. Un *"Stock insuficiente"* suelto ahí no le dice al garzón a
    // qué mesa volver, así que el aviso lleva la mesa y la cuenta congeladas al
    // empezar la edición.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    patchCantidadFalla = true

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(400)

    const aviso = toasts.find(t => /Stock insuficiente/.test(t.title ?? ''))
    expect(aviso).toBeTruthy()
    // 'Mesa 1 · Cuenta 9': las dos del fixture. Sin esto el garzón lee el error
    // de una mesa que ya no está en pantalla y no sabe cuál es.
    expect(aviso!.description).toBe('Mesa 1 · Cuenta 9')

    // Y el rollback corrió aunque la cuenta ya no fuera la activa: volver a
    // entrar —que no pega ninguna llamada— muestra lo que el servidor tiene.
    // Se afirma sobre el `model-value` y no sobre el texto por lo mismo que el
    // test de rollback de arriba: el texto muestra la presentación.
    const tarjeta = drawerMesa()?.querySelector<HTMLElement>('.cursor-pointer')
    tarjeta!.click()
    await esperar(50)
    const trasVolver = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    expect(trasVolver!.props('modelValue')).toBe('1.0000')
  })

  it('cancelar ESPERA la edición pendiente: sale antes del cancelar, y no rebota después', async () => {
    /**
     * ⚠️ **Este test decía lo contrario hasta el 2026-09-05**, y el cambio es
     * una decisión del owner, no una corrección: *"la acción espera a que
     * termine lo que quedó a medio guardar antes de ejecutarse"*.
     *
     * Lo que buscaba la versión anterior sigue valiendo —que el garzón no lea un
     * rechazo por una línea de una cuenta que acaba de cancelar—; lo que cambia
     * es **cómo** se consigue. Antes se tiraba la edición y quedaba una ventana:
     * si los 300 ms se cumplían mientras viajaba el request de cancelar, el
     * `PATCH` ya había salido y no quedaba nada que tirar. Ahora sale **antes**,
     * con la cuenta todavía abierta, así que no hay rechazo que llegue tarde.
     *
     * El costo, dicho: se guarda una cantidad en una cuenta que se va a anular
     * igual. Es un request de más, no plata — la cuenta cancelada no cobra nada.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cancelar cuenta')!.click()
    await esperar(20)
    // El de confirmar vive en el modal, que es OTRO diálogo: el del drawer ya
    // se usó arriba y buscarlo de nuevo devolvería el mismo botón.
    const modal = dialogos().find(d => d !== drawerMesa() && !esModalPin(d))
    botonEn(modal, 'Cancelar cuenta')!.click()
    await esperar(400)

    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])
    // Lo que fija el ORDEN, que es lo que este test cuida: la edición ya había
    // salido cuando llegó el cancelar. Sin esta aserción, mandar después
    // —justo lo que dejaba el toast huérfano— pasaría igual.
    expect(patchesAlCancelar).toBe(1)
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
    // Y el modal se cerró: queda solo el drawer de la mesa. Sin esta aserción, un
    // guard de más en el `finally` lo deja abierto para siempre y la suite no se
    // entera — medido, pasó al escribirlo.
    expect(dialogos().filter(d => !esModalPin(d))).toHaveLength(1)
  })

  it('salir de la cuenta durante la espera no impide que el cancelar salga', async () => {
    /**
     * El gemelo del tap que deselecciona en fusionar, y lo levantó la MISMA
     * revisión en la segunda pasada: el `await flushPendientes()` nuevo dejó
     * `activeCuenta.value.id` releído después. El botón *Cancelar* del modal no
     * está deshabilitado —el `:loading` va solo al de confirmar— y el `UModal`
     * cierra con ESC o backdrop, así que la pantalla vuelve a ser clickeable
     * mientras el flush viaja; desde ahí *Cuentas* pone `activeCuenta` en `null`.
     *
     * Lo medido con la lectura sin congelar: `TypeError: Cannot read properties
     * of null (reading 'id')` adentro del `try`, o sea el toast rojo de siempre
     * con un mensaje de JavaScript y —lo grave— **el cancelar sin salir**. Peor
     * que el agujero de fusionar: aquél mandaba un request malo, éste no
     * ejecuta la acción que el garzón confirmó.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cancelar cuenta')!.click()
    await esperar(20)
    const modal = dialogos().find(d => d !== drawerMesa() && !esModalPin(d))
    botonEn(modal, 'Cancelar cuenta')!.click()
    await esperar(50)

    // El garzón vuelve al listado mientras el flush viaja: `activeCuenta` a null.
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    // Lo que importa: el cancelar SALIÓ. Sin congelar el id, `patchesAlCancelar`
    // se queda en -1 —el request nunca se hizo— y el toast es un `TypeError`.
    expect(patchesAlCancelar).toBeGreaterThanOrEqual(0)
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
    expect(toasts.some(t => t.title === 'Cuenta cancelada')).toBe(true)
    // Y la cuenta cancelada no queda pintada en el listado: el filtro que la
    // saca lee el MISMO id, así que sin congelar sobrevive en pantalla.
    expect(drawerMesa()?.querySelectorAll('.cursor-pointer').length).toBe(0)

    wrapper.unmount()
  })

  it('cancelar una cuenta no se lleva puesta la edición de OTRA', async () => {
    /**
     * Tercera vuelta de la misma forma, y la levantó la tercera pasada de la
     * revisión: congelar el id para el request y para el filtro dejó sin acotar
     * las otras dos sentencias que corren después del mismo `await`.
     * `descartarPendientes()` borraba **todo** `pendingByLinea` —sin mirar de qué
     * cuenta es cada entrada, aunque `EdicionCantidad` lleva su `cuentaId`
     * justamente para esto— y `volverACuentas()` sacaba al garzón de donde
     * estuviera.
     *
     * La escena: confirmo cancelar la cuenta 9 → el modal cierra (ESC/backdrop) →
     * *Cuentas* → abro la cuenta 10 → toco el stepper → vuelve el cancelar de la
     * 9. La edición de la 10 se perdía **en silencio**, con la cantidad optimista
     * pintada y sin rollback: el mismo *"quedó guardado y el servidor no se
     * enteró"* que este frente vino a cerrar, y sobrevivía a salir y volver.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    // Una edición pendiente en la cuenta 9: es lo que hace que el flush del
    // cancelar tenga algo que esperar. Sin esto el cancelar termina entero antes
    // de que el garzón alcance a moverse, y la escena no existe.
    const primerInput = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    primerInput!.vm.$emit('change', {
      presentacion: '2',
      unidadCodigo: 'unidad',
      cantidadCanonica: '2.0000',
    })
    await esperar(20)

    // Cancelar la PRIMERA cuenta, con el flush retenido.
    botonEn(drawerMesa(), 'Cancelar cuenta')!.click()
    await esperar(20)
    const modal = dialogos().find(d => d !== drawerMesa() && !esModalPin(d))
    botonEn(modal, 'Cancelar cuenta')!.click()
    await esperar(50)

    // El garzón se va a la OTRA cuenta y edita ahí.
    const volver = botonEn(drawerMesa(), 'Cuentas')
    expect(volver, 'botón Cuentas del drawer').toBeTruthy()
    volver!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    expect(tarjetas.length, 'tarjetas de cuentas en el listado').toBe(2)
    tarjetas[tarjetas.length - 1]!.click()
    await esperar(50)
    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '5',
      unidadCodigo: 'unidad',
      cantidadCanonica: '5.0000',
    })
    await esperar(20)

    soltar()
    await esperar(500)

    // La edición de la cuenta 10 tiene que haber salido, no haber sido tirada.
    // La de la 9 salió antes, por el flush del propio cancelar.
    expect(patchesDeCantidad).toEqual([
      { lineaId: 'linea-1', cantidad: '2.0000' },
      { lineaId: 'linea-2', cantidad: '5.0000' },
    ])
    // Y el garzón sigue DENTRO de la cuenta 10, no de vuelta en el listado.
    // ⚠️ No sirve buscar "Cuenta 10" en el texto: el listado también la nombra en
    // su tarjeta, así que esa aserción pasa igual con el garzón expulsado
    // (medido: el mutante que saca la condición de `volverACuentas` sobrevivía).
    // El botón *Cuentas* —el de volver— existe solo con una cuenta abierta.
    expect(botonEn(drawerMesa(), 'Cuentas'), 'seguir dentro de la cuenta').toBeTruthy()
    expect(drawerMesa()?.textContent).toContain('— Cuenta 10')

    wrapper.unmount()
  })

  it('fusionar espera lo pendiente aunque el garzón ya haya vuelto al listado', async () => {
    /**
     * La ventana que abrió *"salir de la cuenta guarda"* (2026-09-02): salir
     * manda **sin `await`**, así que el garzón vuelve al listado con el `PATCH`
     * todavía en vuelo, y ahí mismo el listado le ofrece *Fusionar cuentas*.
     * Fusionar deja las cuentas de origen `cancelada`, así que el `PATCH`
     * aterrizaba sobre una cuenta que ya no estaba abierta y volvía con
     * *"La cuenta no está abierta"*, nombrando una cuenta que el garzón acababa
     * de fusionar.
     *
     * Owner, 2026-09-05: la acción espera. Con el `PATCH` retenido, la fusión no
     * puede haber salido todavía; soltándolo, sale con la edición ya guardada.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), segundaCuenta()]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    // Volver al listado: manda lo pendiente y NO espera (por diseño).
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)

    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    expect(tarjetas.length, 'las dos cuentas de la mesa').toBe(2)
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)

    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Todavía no: el `PATCH` sigue retenido.
    expect(fusionesPedidas).toBe(0)

    soltar()
    await esperar(200)

    expect(fusionesPedidas).toBe(1)
    expect(patchesAlFusionar).toBe(1)
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
  })

  it('un tap que deselecciona durante la espera no cambia lo que el garzón pidió fusionar', async () => {
    /**
     * La ventana que abre el `await` de arriba, y la levantó la revisión
     * independiente: la precondición (`length < 2`) se valida ANTES del flush y
     * la selección se releía DESPUÉS. Durante la espera de red las tarjetas
     * siguen clickeables —el `:loading` solo apaga el botón *Fusionar*—, así que
     * un tap dejaba la selección en 1 y el request salía igual: el backend
     * contesta `400 Selecciona al menos dos cuentas para fusionar` y el garzón
     * lee un toast rojo por algo que no pidió. Es el mismo toast confuso que
     * este frente vino a sacar, entrando por la puerta de al lado.
     *
     * Lo que fija: se fusiona **lo que estaba seleccionado al tocar el botón**.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), segundaCuenta()]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)

    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)
    expect(fusionesPedidas).toBe(0)

    // El tap que llega mientras el `PATCH` viaja: deselecciona una.
    tarjetas[1]!.click()
    await esperar(20)

    soltar()
    await esperar(200)

    expect(fusionesPedidas).toBe(1)
    expect(cuentasFusionadas).toHaveLength(2)
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
  })

  it('si el garzón entró a otra cuenta durante la espera, la fusión no lo teletransporta', async () => {
    /**
     * La cuarta pasada de la revisión: congelar la selección no alcanzaba,
     * porque después del `await` la función seguía **escribiendo** la pantalla
     * —`cuentas.value`, `fusionMode`, `seleccionadasFusion` y sobre todo
     * `activeCuenta.value = cuenta`—. Ese último es el gemelo exacto del
     * `volverACuentas()` que este mismo frente acababa de condicionar en
     * cancelar: llevarlo a la cuenta fusionada está bien si sigue en el listado
     * esperándola, y es una expulsión si mientras tanto se puso a trabajar en
     * otra.
     *
     * Dos gestos alcanzan: *Cancelar fusión* y abrir una cuenta.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    // TRES cuentas: se fusionan la 9 y la 10, y el garzón se mete en la 11, que
    // **no** entra en la fusión. Con solo dos, la cuenta en la que se mete es una
    // de las fusionadas y lo correcto es lo contrario (ver el test de abajo).
    cuentasDeLaMesa = [
      cuentaConPedido('1.0000'),
      otraCuentaConPedido('1.0000'),
      terceraCuentaConPedido('1.0000'),
    ]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    // Una edición pendiente: es lo que hace que el flush de la fusión espere.
    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Mientras la fusión viaja: sale del modo fusión y entra a la TERCERA.
    botonEn(drawerMesa(), 'Cancelar fusión')!.click()
    await esperar(20)
    const tarjetasAhora = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetasAhora[tarjetasAhora.length - 1]!.click()
    await esperar(50)

    soltar()
    await esperar(300)

    expect(fusionesPedidas).toBe(1)
    // Sigue en la cuenta que abrió, no en la fusionada.
    expect(drawerMesa()?.textContent).toContain('— Cuenta 11')
    expect(botonEn(drawerMesa(), 'Cuentas'), 'seguir dentro de una cuenta').toBeTruthy()

    wrapper.unmount()
  })

  it('pero si la cuenta donde estaba parado es una de las fusionadas, SÍ lo lleva', async () => {
    /**
     * La otra mitad del guard, y la levantó la quinta pasada de la revisión: el
     * `if (!activeCuenta.value)` cubría una sola sub-escena. Si el garzón quedó
     * parado en una cuenta que **la propia fusión canceló**, dejarlo ahí no es
     * respetar dónde estaba: es abandonarlo en una cuenta que el servidor anuló
     * y que el listado ya no tiene. Todo lo que haga desde ahí —agregar, comanda,
     * cobro— vuelve *"La cuenta no está abierta"*, que es el toast que este
     * frente vino a sacar.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Se mete en la cuenta 10, que es una de las dos que se están fusionando.
    botonEn(drawerMesa(), 'Cancelar fusión')!.click()
    await esperar(20)
    const tarjetasAhora = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetasAhora[tarjetasAhora.length - 1]!.click()
    await esperar(50)
    expect(drawerMesa()?.textContent).toContain('— Cuenta 10')

    soltar()
    await esperar(300)

    // El mock devuelve la fusionada con `numero: 1`.
    expect(drawerMesa()?.textContent).toContain('— Cuenta 1')
    expect(drawerMesa()?.textContent).not.toContain('— Cuenta 10')

    wrapper.unmount()
  })

  it('lo que se toca en una cuenta de origen durante el vuelo no se manda: esa cuenta se anula', async () => {
    /**
     * El gemelo del `descartarPendientes(cuentaId)` de cancelar, y lo levantó la
     * quinta pasada de la revisión con sonda: fusionar no descartaba nada, así
     * que una edición nacida **durante** el vuelo sobre una cuenta de ORIGEN
     * salía después de que la fusión la dejara `cancelada` y volvía con
     * *"La cuenta no está abierta"* — el mismo toast que este frente vino a
     * sacar, entrando por la última puerta que quedaba.
     *
     * ⚠️ **El costo, dicho:** esa edición se pierde. Se descarta, como en
     * cancelar, y la cuenta fusionada muestra la cantidad que quedó del lado del
     * servidor. Mandarla no es opción: el `PATCH` viaja con el `cuentaId` de la
     * cuenta de origen, que la fusión acaba de anular.
     */
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Entra a la cuenta 10 —una de las que se están fusionando— y toca el stepper.
    botonEn(drawerMesa(), 'Cancelar fusión')!.click()
    await esperar(20)
    const tarjetasAhora = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetasAhora[tarjetasAhora.length - 1]!.click()
    await esperar(50)
    const inputOrigen = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    inputOrigen!.vm.$emit('change', {
      presentacion: '7',
      unidadCodigo: 'unidad',
      cantidadCanonica: '7.0000',
    })
    await esperar(20)

    soltar()
    await esperar(500)

    // Salió la edición de la cuenta 9 —esa la mandó el flush, con la cuenta
    // todavía abierta— y NO la de la 10, que la fusión acaba de anular.
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])
    expect(toasts.filter(t => t.color === 'error')).toEqual([])

    wrapper.unmount()
  })

  it('y lo que se toca en la cuenta DESTINO tampoco: la fusión ya le sumó lo del origen', async () => {
    /**
     * El caso simétrico, y el peor de los dos: la sexta pasada de la revisión lo
     * midió con sonda. La cuenta destino **sigue abierta**, así que ese `PATCH`
     * no rebota **por la cuenta**: puede salir, contestar 200 y **pisar** la
     * cantidad que la fusión acababa de sumarle.
     *
     * Contra el backend real (`salones.service.ts`): una línea de origen con la
     * misma clave se pliega sobre la de destino sumando `cantidad` y
     * `cantidadEnviada`, y `actualizarLinea` escribe **absoluto**. El garzón
     * tipea mirando **lo de antes de la fusión**, así que ese número ya no
     * significa lo que él quiso decir, salga como salga: puede rebotar por abajo
     * (el guard de cocina, contra la `cantidadEnviada` sumada), por arriba (el
     * tope de stock) o **entrar y pisar** lo que la fusión sumó. Medido: destino
     * 2 (2 despachadas) + origen 3 (0) = 5 con 2 despachadas, y tipear 3 pasa con
     * 200 comiéndose 2. ⛔ No hay una regla corta de cuándo entra: el comentario
     * del código explica por qué no conviene ni intentarla.
     *
     * ⚠️ **Y el motivo que este mismo cierre había escrito para descartar era
     * falso**: decía que la línea se muda "con otro id". No: la línea que NO
     * matchea se muda **conservando su id** (`linea.cuentaId = destino.id`), y
     * solo la que matchea se borra. El motivo verdadero es más simple: el `PATCH`
     * viaja con el `cuentaId` de origen —cancelada— o con una cantidad calculada
     * antes de la suma. En los dos casos, mandarlo es mentir.
     */
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Entra a la cuenta 9 —la DESTINO, la de menor número— y toca el stepper.
    botonEn(drawerMesa(), 'Cancelar fusión')!.click()
    await esperar(20)
    const tarjetasAhora = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetasAhora[0]!.click()
    await esperar(50)
    const inputDestino = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    inputDestino!.vm.$emit('change', {
      presentacion: '7',
      unidadCodigo: 'unidad',
      cantidadCanonica: '7.0000',
    })
    await esperar(20)

    soltar()
    await esperar(500)

    // Solo la edición que el flush mandó ANTES de fusionar.
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])

    wrapper.unmount()
  })

  it('si CANCELAR falla, la edición no se pierde: se manda igual', async () => {
    // El reverso del reverso, y la regresión que introdujo la primera versión de
    // este cambio: descartar lo pendiente ANTES del request. Cancelar falla de
    // verdad —`400` si otro dispositivo ya cerró la cuenta—, y ahí el garzón se
    // quedaba dentro de la cuenta con la cantidad pintada, sin `PATCH`, sin
    // rollback y sin timer: el mismo "quedó guardado y el servidor no se
    // enteró" que este frente vino a cerrar. Lo midió la revisión del diff.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    cancelarFalla = true

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Cancelar cuenta')!.click()
    await esperar(20)
    const modal = dialogos().find(d => d !== drawerMesa() && !esModalPin(d))
    botonEn(modal, 'Cancelar cuenta')!.click()
    await esperar(500)

    expect(toasts.some(t => /no está abierta/.test(t.title ?? ''))).toBe(true)
    // La cuenta sigue abierta, así que la edición vale y tiene que llegar.
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])
  })

  it('el flush con dos líneas manda UN PATCH por línea, no dos de la segunda', async () => {
    // `flushPendientes` cancelaba los timers DENTRO del loop, así que solo moría
    // el de la primera línea: los de 2..N seguían armados durante la espera de
    // red del primero y disparaban solos. La segunda línea salía dos veces —y
    // con el servidor rechazando, dos toasts idénticos—. Se ve solo con el
    // `PATCH` retenido más de los 300 ms del debounce.
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConDosPedidos()]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const inputs = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    inputs[0]!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    inputs[1]!.vm.$emit('change', { presentacion: '5', unidadCodigo: 'unidad', cantidadCanonica: '5.0000' })
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    // Más que los 300 ms del debounce con el primer PATCH todavía sin contestar:
    // es la ventana exacta en la que el timer de la segunda línea disparaba.
    await esperar(400)
    soltar()
    await esperar(400)

    expect(patchesDeCantidad).toEqual([
      { lineaId: 'linea-1', cantidad: '3.0000' },
      { lineaId: 'linea-2', cantidad: '5.0000' },
    ])
  })

  /**
   * `AppDrawer` stubeado (patrón de `docs/patterns/frontend.md` §15, igual que
   * `CajaCierreDrawer.nuxt.spec.ts`). **Solo lo usa el test de cerrar el
   * drawer**, y por un motivo concreto: cerrar el drawer de verdad dispara la
   * transición de salida de reka, y `usePresence` lee `display` de un
   * `getComputedStyle` que happy-dom rechaza con *"Receiver must be an instance
   * of class CSSStyleDeclaration"*. La suite quedaba en verde pero con dos
   * unhandled rejections, o sea el gate en rojo.
   *
   * Con el stub el contenido **no se teletransporta**: se busca en el wrapper,
   * no en `document.body`.
   */
  const stubDrawer = {
    AppDrawer: {
      name: 'AppDrawer',
      props: ['open', 'width', 'ui'],
      emits: ['update:open'],
      template: '<div v-if="open"><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
    },
  }

  it('después del flush el catálogo vuelve a pedirse: el pendiente quedó liberado', async () => {
    // El gemelo del test de arriba, pero por el camino del **flush** en vez del
    // debounce: `flushPendientes` saca cada entrada de `pendingByLinea` antes de
    // despacharla, y si no lo hiciera el `size > 0` del guard dejaría el
    // refresco del catálogo muerto **para el resto de la sesión** —el garzón
    // seguiría viendo el disponible de antes de su cambio, en todas las mesas—.
    //
    // Lo pidió la revisión del diff: esa línea se reubicó en este cambio y
    // ningún test la cubría.
    catalogoItemsMock = [producto('9.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)
    const antesDeEditar = urlsCatalogo.length

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)
    // El flush, no el timer: se sale de la cuenta dentro de los 300 ms.
    botonEn(drawerMesa(), 'Enviar a cocina')!.click()
    await esperar(700)

    expect(patchesDeCantidad).toHaveLength(1)
    expect(urlsCatalogo.length).toBeGreaterThan(antesDeEditar)
  })

  it('re-editar la segunda línea DURANTE el flush deshace hasta lo que el servidor tiene', async () => {
    // La ventana que abrió el arreglo del doble `PATCH`: vaciar `pendingByLinea`
    // entero antes del loop dejaba a las líneas 2..N sin entrada **y** sin
    // `inflight` hasta que el loop las alcanzara, así que una re-edición ahí
    // adentro recalculaba el `previo` desde la línea —que ya trae el optimista
    // sin confirmar— y dejaba pintada una cantidad que el servidor rechazó.
    //
    // Es la ventana hermana de la que cerró el `Map` de `inflight`, y la
    // encontró la revisión del diff midiendo contra control.
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConDosPedidos()]
    patchCantidadFalla = true
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const inputs = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    inputs[0]!.vm.$emit('change', { presentacion: '3', unidadCodigo: 'unidad', cantidadCanonica: '3.0000' })
    inputs[1]!.vm.$emit('change', { presentacion: '4', unidadCodigo: 'unidad', cantidadCanonica: '4.0000' })
    await esperar(20)

    // *Enviar a cocina* y no *Cuentas*: el flush tiene que correr con la cuenta
    // **todavía en pantalla**, porque lo que se prueba es una re-edición hecha
    // mientras el primer `PATCH` viaja. Saliendo al listado no hay stepper que
    // tocar y el test se apagaría solo.
    botonEn(drawerMesa(), 'Enviar a cocina')!.click()
    await esperar(50)
    // El flush está esperando el PATCH de la primera línea. El garzón vuelve a
    // tocar el stepper de la segunda: el input no se deshabilita mientras se
    // envía, así que en servicio es un gesto normal.
    wrapper.findAllComponents({ name: 'AppCantidadInput' })[1]!
      .vm.$emit('change', { presentacion: '5', unidadCodigo: 'unidad', cantidadCanonica: '5.0000' })
    await esperar(20)
    soltar()
    await esperar(700)

    // El servidor rechazó TODO, así que la segunda línea tiene que volver a lo
    // que tenía antes de la ráfaga: `2.0000` del fixture. Ni `4` ni `5`, que son
    // las dos cantidades que nunca se guardaron.
    const trasTodo = wrapper.findAllComponents({ name: 'AppCantidadInput' })
    expect(trasTodo[1]!.props('modelValue')).toBe('2.0000')
  })

  it('cerrar el drawer de la mesa también manda, y el aviso conserva el contexto', async () => {
    // La quinta salida, y la única que no tenía dueño: cerrar el drawer (ESC,
    // backdrop) no tocaba `activeCuenta` ni lo pendiente. La edición se guardaba
    // de rebote —por el timer— y, con `activeCuenta` viva y nada en pantalla, el
    // toast de rechazo se creía "en la cuenta" y se comía el contexto, que es
    // justo el caso para el que ese texto existe.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    patchCantidadFalla = true

    const wrapper = await mountSuspended(Salones, { global: { stubs: stubDrawer } })
    montado = wrapper
    await esperar(0)
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', mesa())
    await esperar(20)
    // Con el stub la cuenta se busca en el wrapper, no en el body.
    const drawerStub = wrapper.findComponent({ name: 'AppDrawer' })
    ;(drawerStub.element.querySelector('.cursor-pointer') as HTMLElement).click()
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    // Cerrar el drawer como lo cierra el usuario: el componente emite el
    // `update:open` en `false`.
    wrapper.findComponent({ name: 'AppDrawer' }).vm.$emit('update:open', false)
    await esperar(60)
    expect(patchesDeCantidad).toEqual([{ lineaId: 'linea-1', cantidad: '3.0000' }])

    await esperar(300)
    const aviso = toasts.find(t => /Stock insuficiente/.test(t.title ?? ''))
    expect(aviso?.description).toBe('Mesa 1 · Cuenta 9')
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
    // ⚠️ **Este test cubre solo la mitad "todavía no confirmó".** La otra —que al
    // confirmar el servidor SÍ salga el refresco— vive en su propio test, abajo.
    //
    // 📌 Hasta el 2026-09-02 esa otra mitad era **inalcanzable** y acá estaba
    // escrito así: `patchLineaCantidad` hacía `structuredClone` sobre el Proxy
    // reactivo de `activeCuenta`, tiraba `DataCloneError` fuera del `try`, y el
    // `PATCH` no se mandaba nunca. Se arregló, así que la afirmación cambió: ya
    // no es un estado imposible, es un caso con test.
    //
    // El test igual saca la cuenta de pantalla antes de los 300 ms, y ahora por
    // otro motivo: es la única forma de dejar el timer pendiente sin que el
    // PATCH salga, que es exactamente el estado que este test quiere fijar.
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

  /**
   * Una impresora de comanda **activa**. Sin al menos una, `imprimirComanda()`
   * devuelve `null` antes de tocar la red y estos tests estarían probando ese
   * atajo en vez del envío.
   */
  function impresoraDeComanda() {
    return {
      id: 'imp-1',
      nombre: 'Cocina',
      rol: 'comanda',
      activo: true,
      tipoConexion: 'red',
      host: '10.0.0.9',
      puerto: 9100,
      nombreCola: null,
    }
  }

  it('"Enviar a cocina" reclama la comanda de la cuenta abierta', async () => {
    // El control de los dos que siguen. Sin él, un `enviarComanda` que no
    // llamara nunca al claim los haría pasar a los dos por el lado equivocado:
    // "no reclamó la de otra cuenta" es cierto también cuando no reclamó nada.
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    impresorasComanda = [impresoraDeComanda()]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    botonEn(drawerMesa(), 'Enviar a cocina')!.click()
    await esperar(100)

    expect(reclamosDeComanda).toEqual(['cuenta-9'])
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
  })

  it('volver al listado durante la espera no impide que la comanda salga', async () => {
    /**
     * La cuarta puerta de la misma forma —precondición antes del `await`, estado
     * reactivo releído después—. **No la última**: `cerrarCuentaConPin` es la
     * quinta y sigue abierta (`docs/agent/pendientes.md` § 2). `enviarComanda`
     * valida `activeCuenta`, hace `await flushPendientes()` y recién ahí lee
     * `activeCuenta.value.id` —y su `numero`, y su garzón— para armar el claim.
     *
     * Durante esa espera el botón *Cuentas* sigue vivo (`:loading` va solo al de
     * comanda) y pone `activeCuenta` en `null`. Lo medido con la lectura sin
     * congelar: `TypeError` adentro del `try`, que el `catch` muestra como
     * *"Error al enviar la comanda (¿QZ Tray está abierto?)"* — **le echa la
     * culpa a la impresora y la comanda nunca llega a cocina**. Es el peor de
     * los cuatro: el garzón se va tranquilo creyendo que es un problema de QZ.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    impresorasComanda = [impresoraDeComanda()]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    // Una edición a medio guardar: es lo único que abre la ventana del `await`.
    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Enviar a cocina')!.click()
    await esperar(20)

    // El garzón vuelve al listado mientras el flush viaja.
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    expect(reclamosDeComanda).toEqual(['cuenta-9'])
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
  })

  it('meterse en otra cuenta durante la espera no manda la comanda de esa otra', async () => {
    /**
     * El gemelo de *"cancelar una cuenta no se lleva puesta la edición de OTRA"*,
     * y lo que separa **congelar** de **volver a preguntar**: un
     * `if (!activeCuenta.value) return` después del `await` **no crashea** —la
     * cuenta existe— y manda el claim de la cuenta equivocada. (Ese guard rompe
     * el test de arriba por el otro lado: con `activeCuenta` en `null` retorna y
     * la comanda no sale. Por eso el mutante que lo pone mata a los dos.)
     *
     * Y no es un empate: el claim avanza `cantidad_enviada`, así que la 10 queda
     * marcada como despachada sin que su comida se haya pedido, y la 9 —la que
     * el garzón mandó— sigue esperando en cocina.
     */
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    impresorasComanda = [impresoraDeComanda()]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    botonEn(drawerMesa(), 'Enviar a cocina')!.click()
    await esperar(20)

    // Sale al listado y se mete en la OTRA cuenta, todo con el flush en vuelo.
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)
    const tarjetas = drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer')
    expect(tarjetas?.length).toBe(2)
    tarjetas![1]!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    expect(reclamosDeComanda).toEqual(['cuenta-9'])
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
  })

  /**
   * Los seis dígitos del PIN **sin** el paso de abrir el teclado: acá el modal lo
   * abre `solicitarPin` desde el cobro, no un botón *Nueva cuenta*.
   */
  async function tipearPin(quien = 'Ana') {
    const garzon = botonEn(tecladoPin(), quien)
    expect(garzon).toBeTruthy()
    garzon!.click()
    await esperar(10)
    for (let i = 0; i < 6; i++) {
      botonEn(tecladoPin(), '1')!.click()
      await esperar(1)
    }
    await esperar(20)
  }

  /**
   * El cobro se dispara emitiendo `confirmar` en `VentasCobroModal`, que está
   * siempre montado (`v-model:open`). Se saltea la UI del modal a propósito: lo
   * que estos tests ejercitan es lo que pasa **después** del PIN, y montar el
   * cobro entero metería la caja, los métodos y la propina en un test que no
   * habla de nada de eso.
   */
  function confirmarElCobro(wrapper: Awaited<ReturnType<typeof montar>>) {
    wrapper.findComponent({ name: 'VentasCobroModal' }).vm.$emit(
      'confirmar',
      [{ metodoPagoId: 'mp-1', monto: '5000' }],
      '0',
    )
  }

  it('volver al listado durante la espera no se come el cobro que el garzón ya confirmó', async () => {
    /**
     * La quinta puerta de la forma, y la mitad más cara: `confirmarCobro` valida
     * la cuenta, abre el PIN y el callback hace `await flushPendientes()` — pero
     * `cerrarCuentaConPin` recién ahí leía `activeCuenta` para congelarla, o sea
     * **después** de la espera. Volviendo al listado en ese tramo, su
     * `if (!activeCuenta.value) return` cortaba en seco: el garzón cobró, tecleó
     * su PIN, y **no pasaba nada** — sin venta, sin toast, con la cuenta abierta.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    confirmarElCobro(wrapper)
    await esperar(20)
    await tipearPin()

    // El garzón vuelve al listado con el flush todavía en vuelo.
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    expect(cierresDeCuenta).toEqual(['cuenta-9'])
    expect(toasts.filter(t => t.color === 'error')).toEqual([])
    expect(toasts.some(t => t.title === 'Cuenta cerrada — venta generada')).toBe(true)
  })

  it('meterse en otra cuenta durante la espera no cobra esa otra ni le pide su cálculo', async () => {
    /**
     * Dos fallas en una escena, y la segunda es la que separa **congelar** de
     * congelar tarde:
     *
     * 1. `cerrarCuentaConPin` congelaba `activeCuenta` recién **después** del
     *    flush, así que el `POST /cuentas/:id/cerrar` salía con el id de la
     *    cuenta en la que el garzón se acababa de meter. Cobraba la que no era.
     * 2. `asegurarVigente()` calcula el carrito **vivo**. De ahí salen los
     *    totales de la boleta y la proyección local de la caja, así que la
     *    boleta se armaba con las líneas de la cuenta cobrada y los totales de
     *    la otra.
     *
     * Con la cuenta congelada y el cálculo condicionado a seguir parado en ella,
     * lo segundo se degrada al camino que ya existía para cuando no hay cálculo:
     * la venta se genera igual y el aviso lo dice — y esa venta se queda sin
     * boleta, porque acá no hay reimpresión. Se acepta igual: hoy ese mismo
     * gesto deja la venta **sin generar**, que es peor, y es el camino que el
     * cálculo fallado ya tenía. Ver `docs/agent/pendientes.md` § 2.
     */
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    confirmarElCobro(wrapper)
    await esperar(20)
    await tipearPin()

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)
    const tarjetas = drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer')
    expect(tarjetas?.length).toBe(2)
    tarjetas![1]!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    expect(cierresDeCuenta).toEqual(['cuenta-9'])
    expect(toasts.some(t => t.title === 'Venta generada, pero no se pudo generar la boleta')).toBe(true)
    // Y no se lo expulsa de donde está: el `volverACuentas()` del camino feliz
    // se condiciona a seguir parado en la cuenta que se cobró. El botón
    // *Cuentas* solo existe en el detalle, así que su presencia dice en qué
    // vista quedó.
    expect(botonEn(drawerMesa(), 'Cuentas')).toBeTruthy()
    expect(drawerMesa()?.textContent).toContain('Cuenta 10')
  })

  it('cambiar de mesa durante la espera no le descuenta la ocupación a la otra mesa', async () => {
    /**
     * `patchMesaOcupacion(selectedMesa.value.id, -1)` leído vivo le restaba la
     * cuenta a la mesa donde el garzón hubiera ido a parar. Y no se cura solo:
     * `cargarSalones()` corre únicamente en el `onMounted`, así que las dos mesas
     * quedaban mal pintadas —una ocupada de más, la otra de menos— el resto del
     * turno.
     *
     * Las dos mesas arrancan con **una** cuenta abierta a propósito: con la
     * segunda en cero, `Math.max(0, 0 - 1)` la deja en cero y el descuento
     * equivocado sería invisible.
     */
    salonesMock = [{
      id: 'salon-1',
      nombre: 'Principal',
      mesas: [
        { ...mesa(), cuentasAbiertas: 1, ocupada: true },
        { ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: 1, ocupada: true },
      ],
    }]
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    confirmarElCobro(wrapper)
    await esperar(20)
    await tipearPin()

    // Se va a la otra mesa con el flush en vuelo.
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', {
      ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: 1, ocupada: true,
    })
    await esperar(20)

    soltar()
    await esperar(300)

    expect(cierresDeCuenta).toEqual(['cuenta-9'])
    const mesas = wrapper.findComponent({ name: 'SalonesSalonPlano' }).props('mesas') as {
      id: string, cuentasAbiertas: number, ocupada: boolean
    }[]
    expect(mesas.find(m => m.id === MESA_ID)).toMatchObject({ cuentasAbiertas: 0, ocupada: false })
    expect(mesas.find(m => m.id === 'mesa-2')).toMatchObject({ cuentasAbiertas: 1, ocupada: true })
  })

  it('reabrir el cobro durante la espera no cambia la propina con la que se cierra', async () => {
    /**
     * **Lo midió la revisión, contra un comentario mío que decía lo contrario.**
     * El primer arreglo de esta puerta congelaba la cuenta y la mesa y dejaba las
     * propinas vivas, con el argumento de que el modal de cobro ya las había
     * fijado. Pero en esa misma ventana el botón *Cerrar y cobrar* sigue
     * habilitado —`submitting` recién se prende adentro de `cerrarCuentaConPin`—
     * y **un solo tap** reabre el modal, cuyo `watch(open)` reescribe
     * `propinaMonto` con la sugerencia.
     *
     * O sea: el garzón confirma sin propina y el `POST .../cerrar` sale con la
     * sugerida. Es plata, y el backend la persiste en `venta_propina` contra unos
     * `pagos` que sí estaban congelados.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    patchCantidadRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    const input = wrapper.findAllComponents({ name: 'AppCantidadInput' })[0]
    input!.vm.$emit('change', {
      presentacion: '3',
      unidadCodigo: 'unidad',
      cantidadCanonica: '3.0000',
    })
    await esperar(20)

    // Se confirma SIN propina: `propinaMonto` arranca en '0'.
    confirmarElCobro(wrapper)
    await esperar(20)
    await tipearPin()

    // El tap de más, con el flush todavía en vuelo.
    const botonCobrar = botonEn(drawerMesa(), 'Cerrar y cobrar')
    expect(botonCobrar?.disabled).toBe(false)
    botonCobrar!.click()
    await esperar(50)
    // Y el modal efectivamente se reabrió: sin esto el test pasaría por no haber
    // reproducido nada.
    expect(wrapper.findComponent({ name: 'VentasCobroModal' }).props('open')).toBe(true)

    soltar()
    await esperar(300)

    expect(cierresDeCuenta).toEqual(['cuenta-9'])
    expect(bodiesDeCierre).toHaveLength(1)
    expect(bodiesDeCierre[0]).toMatchObject({ propinaMonto: '0' })
  })

  /** Las dos mesas del salón, para los tests que necesitan cambiar de mesa. */
  function dosMesas(abiertas = 0) {
    return [{
      id: 'salon-1',
      nombre: 'Principal',
      mesas: [
        { ...mesa(), cuentasAbiertas: abiertas, ocupada: abiertas > 0 },
        { ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: abiertas, ocupada: abiertas > 0 },
      ],
    }]
  }

  function mesasEnPantalla(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.findComponent({ name: 'SalonesSalonPlano' }).props('mesas') as {
      id: string, cuentasAbiertas: number, ocupada: boolean
    }[]
  }

  it('agregar un producto y volver al listado no te devuelve a la cuenta', async () => {
    /**
     * La familia tiene una mitad con la forma **dada vuelta**: no es leer estado
     * reactivo después del `await`, es **escribirlo**. `syncCuenta` hacía
     * `activeCuenta.value = cuenta` sin preguntar, y lo llaman los tres caminos
     * que mutan la cuenta por request (`addProducto`, `onRecetaConfirm`,
     * `quitarLinea`). Tocar *Cuentas* mientras ese request viajaba y ver la
     * pantalla saltar sola de vuelta al detalle.
     *
     * El gemelo condicionado ya existía siete líneas más abajo
     * (`aplicarCuentaActualizada`), con cinco llamadores.
     */
    catalogoItemsMock = [producto('3.0000', '1.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    agregarLineaRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    drawerMesa()!.querySelector<HTMLElement>(`[data-qa="item-catalogo-${PRODUCTO_ID}"]`)!.click()
    await esperar(20)

    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    // Sigue en el listado: el botón *Cuentas* solo existe en el detalle.
    expect(botonEn(drawerMesa(), 'Cuentas')).toBeUndefined()

    // Y lo que el servidor contestó **sí** entró a la lista: condicionar la
    // escritura entera —congelar de más— habría perdido la línea agregada.
    drawerMesa()!.querySelector<HTMLElement>('.cursor-pointer')!.click()
    await esperar(50)
    expect(wrapper.findAllComponents({ name: 'AppCantidadInput' })).toHaveLength(2)
  })

  it('abrir una cuenta y cambiar de mesa no mete esa cuenta en el listado de la otra', async () => {
    /**
     * `abrirCuentaConPin` congela bien el `mesaId` para la ocupación, pero
     * después del `await` hacía `cuentas.value.push(cuenta)` y `abrirCuenta()`
     * sin preguntar. El modal de PIN ya cerró —emite `confirm` y después se
     * cierra—, así que cambiar de mesa en ese tramo metía una cuenta de la mesa
     * A en el listado de la mesa B, y encima teletransportaba al garzón adentro.
     *
     * Lo levantó la revisión independiente, barriendo el archivo después de que
     * mi propio barrido la pasara por alto.
     */
    salonesMock = dosMesas()
    cuentasPorMesa = { [MESA_ID]: [], 'mesa-2': [] }
    let soltar!: () => void
    abrirCuentaRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    expect(await rondaDePin()).toBe(true)

    // Se va a la otra mesa con el POST en vuelo.
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', {
      ...mesa(), id: 'mesa-2', nombre: 'Mesa 2',
    })
    await esperar(50)

    soltar()
    await esperar(300)

    // El listado que se está mirando es el de la mesa 2, y sigue vacío.
    expect(drawerMesa()?.querySelectorAll('.cursor-pointer').length).toBe(0)
    expect(botonEn(drawerMesa(), 'Cuentas')).toBeUndefined()
    // Pero la cuenta se abrió de verdad, y la ocupación la cuenta la mesa 1:
    // eso va con el `mesaId` congelado, no condicionado.
    expect(postsAbrirCuenta).toHaveLength(1)
    expect(mesasEnPantalla(wrapper).find(m => m.id === MESA_ID)).toMatchObject({ cuentasAbiertas: 1 })
    expect(mesasEnPantalla(wrapper).find(m => m.id === 'mesa-2')).toMatchObject({ cuentasAbiertas: 0 })
  })

  it('dos mesas seguidas: la lista que queda es la de la mesa que se está mirando', async () => {
    /**
     * `cargarCuentas` asignaba `cuentas.value = await …` sin mirar si la mesa
     * seguía siendo la pedida: dos taps rápidos en el plano y ganaba la
     * respuesta que llegara última, no la mesa que el garzón está mirando.
     *
     * El guard es un token de request, como el de `useResultadoCalculado`: un
     * `if (mesaId === selectedMesa.value?.id)` no alcanza —volver a la mesa A
     * después de pasar por B deja pasar la respuesta vieja de A—.
     */
    salonesMock = dosMesas(1)
    cuentasPorMesa = { [MESA_ID]: [cuentaConPedido('1.0000')], 'mesa-2': [otraCuentaConPedido('1.0000')] }
    let soltar!: () => void
    listarCuentasRetenido = {
      [MESA_ID]: new Promise<void>((r) => {
        soltar = r
      }),
    }

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    await esperar(20)

    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', {
      ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: 1, ocupada: true,
    })
    await esperar(50)
    expect(drawerMesa()?.textContent).toContain('Cuenta 10')

    // Llega tarde la de la mesa 1.
    soltar()
    await esperar(300)

    expect(drawerMesa()?.textContent).toContain('Cuenta 10')
    expect(drawerMesa()?.textContent).not.toContain('Cuenta 9')
  })

  it('volver a la mesa que dejaste no deja entrar la respuesta vieja de esa mesa', async () => {
    /**
     * El caso que separa el **token** de un `if (mesaId === selectedMesa.value?.id)`.
     * Con el guard por id, la respuesta vieja de la mesa 1 encuentra la mesa 1
     * otra vez seleccionada y pasa, pisando la lista que el segundo pedido —el
     * que el garzón realmente está mirando— acaba de traer. Sin este test, la
     * frase "un guard por id no alcanza" escrita en el código sería una
     * afirmación sin medir.
     */
    salonesMock = dosMesas(1)
    const mesa2 = { ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: 1, ocupada: true }
    cuentasPorMesa = { [MESA_ID]: [cuentaConPedido('1.0000')], 'mesa-2': [otraCuentaConPedido('1.0000')] }
    let soltar!: () => void
    listarCuentasRetenido = {
      [MESA_ID]: new Promise<void>((r) => {
        soltar = r
      }),
    }

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    await esperar(20)

    // Pasa por la mesa 2 y vuelve. La segunda vuelta a la mesa 1 ya no está
    // retenida, y el servidor mientras tanto tiene otra cosa.
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', mesa2)
    await esperar(50)
    listarCuentasRetenido = {}
    cuentasPorMesa = { ...cuentasPorMesa, [MESA_ID]: [terceraCuentaConPedido('1.0000')] }
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', mesa())
    await esperar(50)
    expect(drawerMesa()?.textContent).toContain('Cuenta 11')

    // Llega la primera respuesta de la mesa 1, la vieja.
    soltar()
    await esperar(300)

    expect(drawerMesa()?.textContent).toContain('Cuenta 11')
    expect(drawerMesa()?.textContent).not.toContain('Cuenta 9')
  })

  it('la respuesta vieja no apaga el spinner de la mesa que todavía está cargando', async () => {
    /**
     * La otra mitad del token, la del `finally`. Sin él, la respuesta de la mesa
     * que el garzón ya dejó apaga el indicador de la que **sí** está esperando, y
     * el listado se ve vacío —"La mesa no tiene cuentas abiertas"— mientras el
     * request viaja.
     *
     * Lo señaló la revisión: el `return` del `try` estaba fijado por dos tests y
     * el `finally` por ninguno, así que un mutante que quitara solo ese guard
     * sobrevivía la suite entera.
     */
    salonesMock = dosMesas(1)
    cuentasPorMesa = { [MESA_ID]: [cuentaConPedido('1.0000')], 'mesa-2': [otraCuentaConPedido('1.0000')] }
    let soltarUno!: () => void
    let soltarDos!: () => void
    listarCuentasRetenido = {
      [MESA_ID]: new Promise<void>((r) => {
        soltarUno = r
      }),
      'mesa-2': new Promise<void>((r) => {
        soltarDos = r
      }),
    }

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    await esperar(20)
    wrapper.findComponent({ name: 'SalonesSalonPlano' }).vm.$emit('select', {
      ...mesa(), id: 'mesa-2', nombre: 'Mesa 2', cuentasAbiertas: 1, ocupada: true,
    })
    await esperar(50)
    expect(drawerMesa()?.querySelector('.animate-spin')).toBeTruthy()

    // Llega la de la mesa 1, que ya nadie está mirando.
    soltarUno()
    await esperar(200)

    expect(drawerMesa()?.querySelector('.animate-spin')).toBeTruthy()
    expect(drawerMesa()?.textContent).not.toContain('La mesa no tiene cuentas abiertas')

    // Y cuando llega la que importa, sí se apaga.
    soltarDos()
    await esperar(200)
    expect(drawerMesa()?.querySelector('.animate-spin')).toBeFalsy()
    expect(drawerMesa()?.textContent).toContain('Cuenta 10')
  })

  it('el modal de transferencia no se abre sobre otra cuenta, ni transfiere la que no era', async () => {
    /**
     * La sub-forma que el barrido anterior no veía: no es leer ni escribir un
     * `ref` después del `await`, es **abrir un modal**. `abrirTransferenciaAdmin`
     * valida la cuenta, hace `await garzonesApi.listar()` —solo la primera vez,
     * después queda cacheada— y abre el modal **sin volver a preguntar**. Y
     * `confirmarTransferenciaAdmin` relee `activeCuenta` **vivo**.
     *
     * O sea: el admin toca *Transferir* parado en la cuenta 9, se va a la 10
     * mientras cargan los garzones, y el modal que aparece —titulado igual, sin
     * decir de qué cuenta habla— **le cambia el responsable a la 10**. Una cuenta
     * que nadie tocó cambia de garzón, y con eso cambia a quién se le atribuye
     * la propina.
     */
    usePermissionsStore().esAdmin = true
    garzonesLista = [
      { id: 'g1', nombre: 'Ana', activo: true },
      { id: 'g2', nombre: 'Bruno', activo: true },
    ]
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000'), otraCuentaConPedido('1.0000')]
    let soltar!: () => void
    listarGarzonesRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    botonEn(drawerMesa(), 'Transferir')!.click()
    await esperar(20)

    // Se va a la otra cuenta mientras cargan los garzones.
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(20)
    const tarjetas = drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer')
    expect(tarjetas?.length).toBe(2)
    tarjetas![1]!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    // El modal no llegó a abrirse. La aserción que manda es ésta: con el guard
    // revertido el test muere acá mismo y no llega al `Confirmar` de abajo, que
    // con el guard puesto no clickea nada. O sea que **este test mide la ausencia
    // del diálogo**; la consecuencia —a qué cuenta se transfiere— la mide el de
    // *"el Confirmar del modal transfiere la cuenta para la que se abrió"*.
    const modalTransferir = dialogos().find(d => (d.textContent ?? '').includes('Transferir responsable'))
    expect(modalTransferir).toBeUndefined()
    botonEn(modalTransferir, 'Confirmar')?.click()
    await esperar(200)
    expect(transferenciasAdmin).toEqual([])
  })

  it('"Transferir" sin irse a ningún lado le cambia el responsable a ESA cuenta', async () => {
    /**
     * El control del de arriba, y no es decorativo: **medido**, un mutante que
     * hace que `abrirTransferenciaAdmin` no entre nunca deja el test de la
     * ventana en verde —"el modal no se abrió" también es cierto cuando la
     * función no corre—. Hoy ese mutante muere con **tres** tests: éste y los
     * otros dos que abren el modal de verdad; cuando se escribió, éste era el
     * único, y sin él sobrevivía la suite entera.
     */
    usePermissionsStore().esAdmin = true
    garzonesLista = [
      { id: 'g1', nombre: 'Ana', activo: true },
      { id: 'g2', nombre: 'Bruno', activo: true },
    ]
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]

    const wrapper = await montar()
    await abrirLaCuenta(wrapper)
    await esperar(400)

    botonEn(drawerMesa(), 'Transferir')!.click()
    await esperar(100)

    const modalTransferir = dialogos().find(d => (d.textContent ?? '').includes('Transferir responsable'))
    expect(modalTransferir).toBeTruthy()
    botonEn(modalTransferir, 'Confirmar')!.click()
    await esperar(200)

    expect(transferenciasAdmin).toEqual(['cuenta-9'])
    expect(toasts.some(t => t.title === 'Responsable actualizado')).toBe(true)
  })

  it('abrir una cuenta nueva mientras estás dentro de otra no te saca de donde estás', async () => {
    /**
     * El guard de `abrirCuentaConPin` era **por mesa**, y eso dejaba abierta la
     * puerta de quedarse en la misma mesa: tocás *Nueva cuenta*, tecleás el PIN,
     * y mientras el `POST` viaja te metés en una cuenta que ya estaba. Al
     * aterrizar, `abrirCuenta()` te cambiaba `activeCuenta` por abajo.
     *
     * Y no es solo "me movió la pantalla": lo midió la revisión con un modal
     * abierto encima. El modal sigue ahí —el overlay no frena la continuación de
     * un request— y su *Confirmar* actuaba sobre la cuenta recién creada: la
     * transferencia le cambiaba el responsable a la nueva, y el cobro cerraba esa
     * cuenta vacía con los pagos juntados para la otra.
     */
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    abrirCuentaRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    expect(await rondaDePin()).toBe(true)

    // Se mete en la cuenta que ya estaba, con el POST todavía en vuelo.
    drawerMesa()!.querySelector<HTMLElement>('.cursor-pointer')!.click()
    await esperar(20)

    soltar()
    await esperar(300)

    // Sigue en la cuenta 9, no en la recién creada.
    expect(drawerMesa()?.textContent).toContain('Cuenta 9')
    expect(drawerMesa()?.textContent).not.toContain('Cuenta 1 ')
    // Pero la cuenta nueva se creó y está en el listado: condicionar el `push`
    // —congelar de más— la habría perdido.
    expect(postsAbrirCuenta).toHaveLength(1)
    botonEn(drawerMesa(), 'Cuentas')!.click()
    await esperar(50)
    expect(drawerMesa()?.querySelectorAll('.cursor-pointer').length).toBe(2)
  })

  it('el Confirmar del modal transfiere la cuenta para la que se abrió, no la que quedó activa', async () => {
    /**
     * La sonda con la que la revisión refutó el porqué que este arreglo había
     * escrito primero —*"con el guard, nada puede cambiar `activeCuenta` mientras
     * el modal está abierto"*—. Lo medido entonces: `POST .../transferir-admin`
     * salía con la cuenta recién creada.
     *
     * El camino quedó cerrado de los dos lados: `abrirCuentaConPin` ya no entra a
     * la cuenta nueva si el garzón está adentro de otra, **y** el modal se lleva
     * su cuenta adentro en vez de releer la activa.
     */
    usePermissionsStore().esAdmin = true
    garzonesLista = [
      { id: 'g1', nombre: 'Ana', activo: true },
      { id: 'g2', nombre: 'Bruno', activo: true },
    ]
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [cuentaConPedido('1.0000')]
    let soltar!: () => void
    abrirCuentaRetenido = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    expect(await rondaDePin()).toBe(true)

    drawerMesa()!.querySelector<HTMLElement>('.cursor-pointer')!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Transferir')!.click()
    await esperar(100)
    const modalTransferir = dialogos().find(d => (d.textContent ?? '').includes('Transferir responsable'))
    expect(modalTransferir).toBeTruthy()

    // Aterriza la apertura de la cuenta nueva con el modal ya abierto.
    soltar()
    await esperar(200)

    botonEn(modalTransferir, 'Confirmar')!.click()
    await esperar(200)

    expect(transferenciasAdmin).toEqual(['cuenta-9'])
  })

  it('una fusión que aterriza con el modal abierto no le cambia el destinatario', async () => {
    /**
     * **El camino que refutó mi segunda explicación.** Cerrada la puerta de
     * `abrirCuentaConPin`, escribí que ya nada podía cambiar `activeCuenta` con un
     * modal abierto — y la revisión midió que `fusionarSeleccionadas` sí: cuando
     * el garzón quedó parado en una de las cuentas fusionadas, su continuación
     * hace `activeCuenta.value = cuenta` con **otro id**, y el overlay no frena la
     * continuación de un request.
     *
     * Sin la cuenta congelada adentro del modal, el *Confirmar* le cambiaba el
     * responsable a la cuenta fusionada en vez de a la que el admin tenía
     * enfrente. Es la misma clase de desvío que el frente vino a cerrar, por una
     * tercera puerta.
     */
    usePermissionsStore().esAdmin = true
    // **Un solo garzón activo, y las dos cuentas con responsables distintos.** Es
    // lo que hace observable la otra mitad del congelado: `garzonesTransferibles`
    // saca al responsable de la cuenta, así que leído de `activeCuenta` la lista
    // queda VACÍA cuando aterriza la fusión (responsable g1) y el *Confirmar* se
    // deshabilita para una transferencia que era válida. Con dos garzones el
    // mutante sobrevive — medido.
    garzonesLista = [{ id: 'g1', nombre: 'Ana', activo: true }]
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = [
      cuentaConPedido('1.0000'),
      { ...otraCuentaConPedido('1.0000'), garzonResponsableId: 'g2', garzonResponsableNombre: 'Bruno' },
    ]
    let soltar!: () => void
    fusionRetenida = new Promise<void>((r) => {
      soltar = r
    })

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    await esperar(50)

    botonEn(drawerMesa(), 'Fusionar cuentas')!.click()
    await esperar(20)
    const tarjetas = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    expect(tarjetas.length).toBe(2)
    tarjetas[0]!.click()
    tarjetas[1]!.click()
    await esperar(20)
    botonEn(drawerMesa(), 'Fusionar (2)')!.click()
    await esperar(50)

    // Sale del modo fusión y se mete en la cuenta 10, con el POST en vuelo.
    botonEn(drawerMesa(), 'Cancelar fusión')!.click()
    await esperar(20)
    const tarjetasTrasSalir = [...(drawerMesa()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])]
    tarjetasTrasSalir[1]!.click()
    await esperar(50)
    expect(drawerMesa()?.textContent).toContain('Cuenta 10')

    botonEn(drawerMesa(), 'Transferir')!.click()
    await esperar(100)
    const modalTransferir = dialogos().find(d => (d.textContent ?? '').includes('Transferir responsable'))
    expect(modalTransferir).toBeTruthy()

    // Aterriza la fusión: `activeCuenta` pasa a ser la fusionada.
    soltar()
    await esperar(200)

    const confirmar = botonEn(modalTransferir, 'Confirmar')
    expect(confirmar?.disabled, 'el Confirmar sigue habilitado: la lista de garzones es la de la cuenta del modal').toBe(false)
    confirmar!.click()
    await esperar(200)

    expect(transferenciasAdmin).toEqual(['cuenta-10'])
  })

  it('abrir una cuenta desde el listado sí te mete adentro', async () => {
    /**
     * El control del guard nuevo de `abrirCuentaConPin`. Sin él, un
     * `if (false) abrirCuenta(cuenta)` —la cuenta nueva no se abre nunca—
     * sobrevive la suite entera: los tests de la ventana afirman que **no** te
     * mueve, y eso también es cierto cuando no se abre nada. Medido antes de
     * escribirlo.
     */
    catalogoItemsMock = [producto('20.0000', '10.0000')]
    cuentasDeLaMesa = []

    const wrapper = await montar()
    await seleccionarMesa(wrapper)
    expect(await rondaDePin()).toBe(true)
    await esperar(100)

    // Quedó adentro de la cuenta recién creada: el botón *Cuentas* solo existe
    // en el detalle.
    expect(botonEn(drawerMesa(), 'Cuentas')).toBeTruthy()
    expect(drawerMesa()?.textContent).toContain('Cuenta 1')
  })
})
