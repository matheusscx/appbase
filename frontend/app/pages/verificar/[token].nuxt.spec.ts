// @vitest-environment nuxt
//
// La pantalla pública de verificación del auto-registro. Igual que su hermana
// `confirmacion/[token]`, nadie la ve durante el desarrollo: no está en el menú
// y se llega sólo desde un link de mail, así que lo que se sostiene acá es el
// RENDER de cada estado.
//
// Y una cosa más, que es la que motivó el spec: **que NO verifique al montar**.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Verificar from './[token].vue'

const TOKEN = 'tok-abc'

/**
 * Cada llamada al backend: `[url, método]`.
 *
 * Se filtran a `/auth/verificar/`: al montar cualquier página, el plugin que
 * restaura la sesión dispara su propio `POST /auth/refresh`. Contarlo haría que
 * la aserción de "no verifica al montar" fallara por algo que no es esta
 * pantalla — y, peor, que siguiera fallando aunque el bug estuviera arreglado.
 */
let llamadas: [string, string][] = []
const alBackend = () =>
  llamadas.filter(([url]) => url.includes('/auth/verificar/'))
/** `null` = el backend acepta; un string fuerza el error. */
let errorBackend: string | null = null

mockNuxtImport('useRoute', () => {
  return () => ({ params: { token: TOKEN }, path: `/verificar/${TOKEN}` })
})

let montado: { unmount: () => void } | null = null

beforeEach(() => {
  llamadas = []
  errorBackend = null
  vi.stubGlobal('$fetch', (url: string, opts?: { method?: string }) => {
    llamadas.push([url, opts?.method ?? 'GET'])
    if (errorBackend) {
      return Promise.reject(new Error(errorBackend))
    }
    return Promise.resolve({ message: 'Listo, tu correo quedó verificado.' })
  })
})

afterEach(() => {
  montado?.unmount()
  montado = null
  vi.unstubAllGlobals()
})

describe('verificar/[token]', () => {
  it('NO verifica al montar: espera el clic', async () => {
    // La razón de ser del cambio. Verificando en `onMounted`, cualquier cosa
    // que RENDERICE el link lo consume — y los proveedores de correo abren las
    // URLs de los mails entrantes con sus escáneres de seguridad. Eso convierte
    // "la persona hizo clic" en "algo abrió el link", que es justo la
    // afirmación que este token existe para sostener.
    const wrapper = await mountSuspended(Verificar)
    montado = wrapper

    expect(alBackend()).toEqual([])
    expect(wrapper.text()).toContain('Confirmá que este correo es tuyo')
  })

  it('el clic manda el POST al token de la URL', async () => {
    const wrapper = await mountSuspended(Verificar)
    montado = wrapper

    await wrapper.find('button').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(alBackend()).toHaveLength(1)
    expect(alBackend()[0]![0]).toContain(`/auth/verificar/${TOKEN}`)
    expect(alBackend()[0]![1]).toBe('POST')
  })

  it('verificado: muestra el mensaje del backend y el paso siguiente', async () => {
    const wrapper = await mountSuspended(Verificar)
    montado = wrapper

    await wrapper.find('button').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Correo verificado')
    expect(wrapper.text()).toContain('quedó verificado')
  })

  it('link vencido: no manda al login, que sería un callejón sin salida', async () => {
    // Sin el correo verificado el login corta igual, así que ofrecer "iniciar
    // sesión" acá dejaría a la persona dando vueltas. Se la manda a registrarse
    // de nuevo, que es lo que reenvía el link.
    errorBackend = 'Ese link ya no sirve'
    const wrapper = await mountSuspended(Verificar)
    montado = wrapper

    await wrapper.find('button').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Este link ya no sirve')
    expect(wrapper.text()).toContain('Pedir un link nuevo')
    expect(wrapper.text()).not.toContain('Iniciar sesión')
  })
})
