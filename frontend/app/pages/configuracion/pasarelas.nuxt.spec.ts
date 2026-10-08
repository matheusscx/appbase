// @vitest-environment nuxt
//
// El drawer de "Mis pasarelas" no manda una credencial vacía (2026-10-08).
// `ConfiguracionPasarelaDto` rechaza con 400 un código o un secreto vacío o de
// solo espacios (`/\S/`); hasta ese día la pantalla mandaba el código hijo de
// MALL vacío, el backend lo guardaba y el cobro fallaba recién en Transbank.
// La pantalla lleva el gemelo del `/\S/` del backend: `.trim()` vacío es vacío,
// en MALL (el código hijo) y en INDIVIDUAL (las tres juntas, como ya pedía). El
// tope de 255 no tiene gemelo: si se pasa, lo dice el 400 en el toast.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Pasarelas from './pasarelas.vue'

const CONFIG_ID = 'tp-webpay'

interface ToastCapturado { title?: string, color?: string }
let toasts: ToastCapturado[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: ToastCapturado) => {
      toasts.push(t)
    },
  })
})

// Nuxt instala su propia Pinia: el permiso se mockea en el auto-import.
mockNuxtImport('usePermissionsStore', () => {
  return () => ({ esAdmin: true, can: () => true })
})

interface Llamada { url: string, method: string, body: unknown }
let llamadas: Llamada[] = []
let modoGuardado: 'mall' | 'individual' = 'mall'

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method === 'PATCH') return Promise.resolve({ tenantPasarelaId: CONFIG_ID })
    if (url.endsWith('/pasarela/admin/config')) {
      return Promise.resolve([{
        tenantPasarelaId: CONFIG_ID,
        pasarelaId: 'webpay',
        codigo: 'webpay_plus',
        nombre: 'Transbank Webpay Plus',
        ambiente: 'pruebas',
        modoIntegracion: modoGuardado,
        activo: true,
        prioridad: 1,
        tieneCredenciales: true,
        creadoEl: '2026-10-08T12:00:00.000Z',
      }])
    }
    if (url.endsWith('/pasarelas-disponibles')) {
      return Promise.resolve([{
        pasarelaId: 'webpay',
        codigo: 'webpay_plus',
        nombre: 'Transbank Webpay Plus',
        soportaTokenizacion: false,
        soportaCobroRecurrente: false,
        soportaMall: true,
      }])
    }
    return Promise.resolve([])
  }
})

/** `AppDrawer` stubeado por lo mismo que en `garzones.nuxt.spec.ts`: el
 * `UDrawer` real revienta al cerrarse bajo happy-dom. Los inputs y el botón
 * siguen siendo los de la página. */
async function montarYEditar() {
  const wrapper = await mountSuspended(Pasarelas, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: `
            <div v-if="open" role="dialog">
              <slot name="body" />
              <slot name="actions" />
            </div>
          `,
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 0))
  await wrapper.find('[aria-label="Editar"]').trigger('click')
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montarYEditar>>

/** Tipea en el input cuyo campo tiene `etiqueta` (el `@input` marca la credencial como tocada). */
async function tipear(wrapper: Wrapper, etiqueta: string, valor: string) {
  const campo = wrapper.findAll('[role="dialog"] div')
    .find(d => d.find('label').exists() && d.find('label').text() === etiqueta)
  expect(campo, `campo "${etiqueta}"`).toBeTruthy()
  await campo!.find('input').setValue(valor)
}

async function guardar(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text() === 'Guardar')
  expect(boton, 'botón Guardar').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 0))
}

const patches = () => llamadas.filter(l => l.method === 'PATCH')

describe('configuracion/pasarelas — el drawer no manda una credencial vacía', () => {
  beforeEach(() => {
    toasts = []
    llamadas = []
    modoGuardado = 'mall'
  })

  it('MALL: un código hijo de solo espacios avisa y no guarda', async () => {
    const wrapper = await montarYEditar()
    await tipear(wrapper, 'Código de comercio hijo', '   ')
    await guardar(wrapper)

    expect(patches()).toHaveLength(0)
    expect(toasts).toContainEqual({
      title: 'El código de comercio hijo no puede quedar vacío',
      color: 'warning',
    })
    wrapper.unmount()
  })

  it('MALL: con el código hijo escrito, guarda solo eso (control)', async () => {
    const wrapper = await montarYEditar()
    await tipear(wrapper, 'Código de comercio hijo', '597055555536')
    await guardar(wrapper)

    expect(patches()).toHaveLength(1)
    expect((patches()[0]!.body as { configuracion: unknown }).configuracion)
      .toEqual({ commerceCodeHijo: '597055555536' })
    wrapper.unmount()
  })

  // Cada una de las tres por separado: sacarle el `.trim()` a una sola da rojo.
  it.each([
    'Código de comercio mall',
    'API key secret',
    'Código de comercio hijo',
  ])('INDIVIDUAL: "%s" de solo espacios avisa y no guarda', async (enBlanco) => {
    modoGuardado = 'individual'
    const wrapper = await montarYEditar()
    for (const etiqueta of ['Código de comercio mall', 'API key secret', 'Código de comercio hijo'])
      await tipear(wrapper, etiqueta, etiqueta === enBlanco ? '  ' : '597055555536')
    await guardar(wrapper)

    expect(patches()).toHaveLength(0)
    expect(toasts).toContainEqual({
      title: 'En modo individual debes reingresar las 3 credenciales juntas',
      color: 'warning',
    })
    wrapper.unmount()
  })
})
