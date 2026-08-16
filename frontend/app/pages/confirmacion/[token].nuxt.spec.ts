// @vitest-environment nuxt
//
// La pantalla pública de "te están sumando a X". Es la única de todo el flujo
// que nadie ve durante el desarrollo: no está en el menú, no la abre ningún
// test de navegación y se llega solo desde un link de mail. Un auto-import
// faltante o un estado que no pinta se descubriría recién con una persona real
// del otro lado, así que lo que se sostiene acá es el RENDER de cada estado.
//
// El token se consulta en `onMounted` con `$fetch` (no `useApiFetch`: la
// pantalla es pública y no hay sesión que autenticar), así que el mock es un
// `stubGlobal`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Confirmacion from './[token].vue'

const TOKEN = 'tok-123'

/** Cada llamada al backend: `[url, método]`. La sonda del POST. */
let llamadas: [string, string][] = []
/** Respuesta del `GET`: `null` fuerza el link inválido. */
let datosToken: { correo: string, tenant: string } | null = null
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useRoute', () => {
  return () => ({ params: { token: TOKEN }, path: `/confirmacion/${TOKEN}` })
})

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => {
      toasts.push(t)
    },
  })
})

const navegado: string[] = []
mockNuxtImport('navigateTo', () => {
  return (to: string) => {
    navegado.push(to)
    return Promise.resolve()
  }
})

let montado: { unmount: () => void } | null = null

beforeEach(() => {
  llamadas = []
  toasts = []
  navegado.length = 0
  datosToken = { correo: 'beto@example.com', tenant: 'Bar Central' }

  vi.stubGlobal('$fetch', (url: string, opts?: { method?: string }) => {
    llamadas.push([url, opts?.method ?? 'GET'])
    if (!opts?.method) {
      return datosToken
        ? Promise.resolve(datosToken)
        : Promise.reject({ data: { message: 'El link venció' } })
    }
    return Promise.resolve({ message: 'Listo, ya sos parte de Bar Central' })
  })
})

afterEach(() => {
  montado?.unmount()
  montado = null
})

async function montar() {
  const wrapper = await mountSuspended(Confirmacion)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

function boton(wrapper: Awaited<ReturnType<typeof montar>>, texto: string | RegExp) {
  const re = typeof texto === 'string' ? new RegExp(texto, 'i') : texto
  return wrapper.findAll('button').find(b => re.test(b.text()))
}

describe('confirmacion/[token] — el link del mail', () => {
  it('el token se consulta antes de mostrar nada, y la consulta no es un POST', async () => {
    await montar()

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]![0]).toContain(`/tenants/confirmacion/${TOKEN}`)
    expect(llamadas[0]![1]).toBe('GET')
  })

  it('dice "te están sumando a X", no "confirmá tu correo"', async () => {
    const wrapper = await montar()
    const texto = wrapper.text()

    // El matiz de producto: quien llega acá puede tener cuenta en OTRA empresa
    // y su correo no está en duda. Lo que se le pregunta es si se suma a ésta.
    expect(texto).toContain('Te están sumando a Bar Central')
    expect(texto).toContain('beto@example.com')
    expect(texto).not.toMatch(/confirmá tu correo/i)
    // No se elige contraseña: la persona ya tiene cuenta.
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(0)
  })

  it('el link vencido se avisa con el motivo del backend y no ofrece aceptar', async () => {
    datosToken = null

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Este link ya no sirve')
    expect(wrapper.text()).toContain('El link venció')
    expect(boton(wrapper, 'quiero sumarme')).toBeFalsy()
  })

  it('aceptar postea al mismo token y manda a iniciar sesión', async () => {
    const wrapper = await montar()

    await boton(wrapper, 'quiero sumarme')!.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(llamadas).toHaveLength(2)
    expect(llamadas[1]).toEqual([
      expect.stringContaining(`/tenants/confirmacion/${TOKEN}`),
      'POST',
    ])
    expect(toasts.at(-1)?.color).toBe('success')
    expect(navegado).toEqual(['/login'])
  })

  it('"Ahora no" no escribe nada y lo dice', async () => {
    const wrapper = await montar()

    await boton(wrapper, 'Ahora no')!.trigger('click')
    await wrapper.vm.$nextTick()

    // No quedar obligada es el punto: la salida no puede disparar el POST.
    expect(llamadas).toHaveLength(1)
    expect(wrapper.text()).toContain('No hicimos nada')
    expect(wrapper.text()).toContain('No te sumamos a Bar Central')
  })

  it('un POST que falla deja el error a la vista y no navega', async () => {
    vi.stubGlobal('$fetch', (url: string, opts?: { method?: string }) => {
      llamadas.push([url, opts?.method ?? 'GET'])
      if (!opts?.method) return Promise.resolve(datosToken)
      return Promise.reject({ data: { message: 'Ya sos parte de esta empresa' } })
    })

    const wrapper = await montar()
    await boton(wrapper, 'quiero sumarme')!.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Ya sos parte de esta empresa')
    expect(navegado).toHaveLength(0)
  })
})
