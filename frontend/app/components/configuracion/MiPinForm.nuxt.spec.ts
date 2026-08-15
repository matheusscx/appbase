// @vitest-environment nuxt
//
// El bloque "Mi PIN" del perfil: se apoya en `GET /garzones/mi-pin` (404 si la
// cuenta no es garzón en el tenant activo) y `PATCH /garzones/mi-pin`. El caso
// que más importa es el 404: el bloque entero no se renderiza, porque "Mi PIN"
// no significa nada para quien no atiende un salón.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import MiPinForm from './MiPinForm.vue'
import type { MiPinEstado } from '~/composables/useGarzones'

function errorApi(message: string, status = 400) {
  const e = new Error(message) as Error & { data?: unknown, statusCode?: number }
  e.data = { message }
  e.statusCode = status
  return e
}

let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => {
      toasts.push(t)
    },
  })
})

/** `null` simula el 404: la cuenta no es garzón en este tenant. */
let miPinRespuesta: MiPinEstado | null = null
let fijarMiPinError: string | null = null
let fijarMiPinBody: Record<string, unknown> | null = null
/**
 * Cuando `miPinRespuesta` es `null`, el `GET` rechaza por default con 404
 * (el caso normal). Estas dos variables fuerzan un status **distinto** —
 * 500, timeout, lo que sea— para probar que ESE caso sí avisa.
 */
let cargaMiPinErrorStatus = 404
let cargaMiPinErrorMensaje = 'Tu cuenta no es un garzón en este local'

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string' || !url.includes('/garzones/mi-pin')) {
      return Promise.resolve(undefined)
    }
    const method = opts?.method ?? 'GET'
    if (method === 'PATCH') {
      fijarMiPinBody = opts?.body ?? null
      if (fijarMiPinError) return Promise.reject(errorApi(fijarMiPinError))
      return Promise.resolve(undefined)
    }
    // GET
    if (!miPinRespuesta) return Promise.reject(errorApi(cargaMiPinErrorMensaje, cargaMiPinErrorStatus))
    return Promise.resolve(miPinRespuesta)
  }
})

async function montar() {
  const wrapper = await mountSuspended(MiPinForm)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  miPinRespuesta = null
  fijarMiPinError = null
  fijarMiPinBody = null
  cargaMiPinErrorStatus = 404
  cargaMiPinErrorMensaje = 'Tu cuenta no es un garzón en este local'
  toasts = []
})

describe('MiPinForm — el bloque "Mi PIN" del perfil', () => {
  it('no renderiza nada si la cuenta no es garzón (404 de /garzones/mi-pin)', async () => {
    miPinRespuesta = null

    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Mi PIN')
    // El 404 es el caso normal: se traga en silencio, sin toast.
    expect(toasts).toEqual([])
  })

  // Sin esto, un 500/timeout/red caída da EXACTAMENTE el mismo resultado que
  // el 404 esperado: bloque invisible, sin ningún aviso. Un garzón real se
  // quedaría sin ver "Mi PIN" y sin ninguna pista de por qué.
  it('un error que no es 404 al cargar SÍ avisa por toast (no queda indistinguible del 404)', async () => {
    miPinRespuesta = null
    cargaMiPinErrorStatus = 500
    cargaMiPinErrorMensaje = 'Error interno del servidor'

    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Mi PIN')
    expect(toasts).toEqual([{ title: 'Error interno del servidor', color: 'error' }])
  })

  it('avisa cuando todavía no hay PIN fijado', async () => {
    miPinRespuesta = { fijado: false, eventos: [] }

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Mi PIN')
    expect(wrapper.text()).toContain('Todavía no tenés PIN')
    // ⚠️ El cuerpo del aviso no tenía NINGUNA aserción hasta el 2026-08-15,
    // así que la redacción que prometía "Desde el tuyo trabajás normal"
    // podía volver a entrar sin poner nada en rojo. Y es la peor pantalla
    // donde puede pasar: es la que SÍ alcanza el garzón sin
    // `Salones:Operar` —el perfil no tiene gate de permiso y
    // `GET /garzones/mi-pin` tampoco—, o sea justo a quien esa promesa le
    // mentiría. El permiso no viaja en `MiPinEstado` (`{ fijado, eventos }`),
    // así que el texto no puede condicionarse: solo puede no prometer.
    expect(wrapper.text()).toContain('Sin PIN no podés operar desde un dispositivo compartido')
    expect(wrapper.text()).not.toMatch(/trabajás normal|Desde el tuyo/)
  })

  it('no avisa cuando ya está fijado', async () => {
    miPinRespuesta = { fijado: true, eventos: [] }

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Mi PIN')
    expect(wrapper.text()).not.toContain('Todavía no tenés PIN')
  })

  it('muestra el historial de eventos que trae el backend', async () => {
    miPinRespuesta = {
      fijado: true,
      eventos: [
        { id: 'e1', tipo: 'fijado_por_garzon', usuarioNombre: 'ana.torres', creadoEl: '2026-08-10T12:00:00.000Z' },
      ],
    }

    const wrapper = await montar()

    // El historial es un REGISTRO y no tutea, aunque acá lo lea el propio
    // garzón: el mismo componente lo lee el encargado en la ficha. Lo que
    // tutea es el aviso de arriba ("Todavía no tenés PIN").
    expect(wrapper.text()).toContain('ana.torres puso su propio PIN')
  })

  it('sin eventos, el historial dice que todavía no hubo cambios', async () => {
    miPinRespuesta = { fijado: true, eventos: [] }

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Todavía no hubo cambios de PIN')
  })

  it('guardar manda pin y confirmarPin, avisa por toast y recarga el estado', async () => {
    miPinRespuesta = { fijado: false, eventos: [] }

    const wrapper = await montar()
    await wrapper.find('input[type="password"]').setValue('135790')
    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[1]!.setValue('135790')

    // Tras guardar, el mock pasa a reportar el PIN fijado — así la aserción
    // de recarga es observable (el aviso de "todavía no tenés PIN" desaparece).
    miPinRespuesta = { fijado: true, eventos: [] }

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(fijarMiPinBody).toEqual({ pin: '135790', confirmarPin: '135790' })
    expect(toasts).toEqual([{ title: 'PIN actualizado', color: 'success' }])
    expect(wrapper.text()).not.toContain('Todavía no tenés PIN')
  })

  it('un error al guardar (ej: PIN obvio) se muestra con el mensaje que vuelve del backend', async () => {
    miPinRespuesta = { fijado: false, eventos: [] }
    fijarMiPinError = 'Ese PIN es demasiado previsible. Elegí uno que no sea todo el mismo dígito ni una secuencia.'

    const wrapper = await montar()
    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0]!.setValue('111111')
    await inputs[1]!.setValue('111111')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(toasts).toEqual([{ title: fijarMiPinError, color: 'error' }])
  })
})
