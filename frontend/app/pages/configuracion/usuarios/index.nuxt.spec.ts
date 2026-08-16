// @vitest-environment nuxt
//
// El alta dejó de adoptar cuentas: si el correo ya existe, la persona tiene que
// aceptar y **mientras tanto no es miembro**. Del lado del admin eso se ve como
// una fila que está pero no entra, y el modo de falla es de percepción, no de
// código: sin una señal en pantalla el alta se lee como fallada y se repite.
//
// Por eso lo que este spec sostiene es el RENDER —el badge en la fila, el aviso
// de arriba, los botones apagados— y no el estado interno. `build`, `typecheck`
// y las revisiones no ven nada de eso.
//
// Molde: `configuracion/garzones.nuxt.spec.ts` (mock de `useApiFetch` por URL +
// captura de `useToast`, porque los toasts no se leen del DOM sin `UApp`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Usuarios from './index.vue'

interface MemberFake {
  usuarioId: string
  nombre: string
  apellido: string
  correo: string
  esTotem: boolean
  pendienteConfirmacion: boolean
  roles: { rolId: string, nombre: string }[]
}

let membersBackend: MemberFake[] = []
/** Lo que devuelve `POST /tenants/usuarios`: los tres desenlaces del alta. */
let respuestaAlta = {
  usuarioId: 'u-nuevo',
  correo: 'nuevo@example.com',
  invitado: false,
  pendienteConfirmacion: false,
}
let toasts: { title?: string, description?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, description?: string, color?: string }) => {
      toasts.push(t)
    },
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/tenants/usuarios') && opts?.method === 'POST')
      return Promise.resolve(respuestaAlta)
    if (url.includes('/tenants/members')) return Promise.resolve(membersBackend)
    if (url.includes('/roles')) return Promise.resolve([{ id: 'r-1', nombre: 'Cajero' }])
    return Promise.resolve([])
  }
})

function miembro(over: Partial<MemberFake> = {}): MemberFake {
  return {
    usuarioId: 'u-1',
    nombre: 'Ana',
    apellido: 'Torres',
    correo: 'ana@example.com',
    esTotem: false,
    pendienteConfirmacion: false,
    roles: [{ rolId: 'r-1', nombre: 'Cajero' }],
    ...over,
  }
}

let montado: { unmount: () => void } | null = null

beforeEach(() => {
  membersBackend = []
  toasts = []
  respuestaAlta = {
    usuarioId: 'u-nuevo',
    correo: 'nuevo@example.com',
    invitado: false,
    pendienteConfirmacion: false,
  }
})

afterEach(() => {
  montado?.unmount()
  montado = null
})

async function montar() {
  const wrapper = await mountSuspended(Usuarios)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('configuracion/usuarios — quien todavía no aceptó se distingue', () => {
  it('la fila pendiente lleva su badge y la confirmada no', async () => {
    membersBackend = [
      miembro({ usuarioId: 'u-1', nombre: 'Ana', correo: 'ana@example.com' }),
      miembro({
        usuarioId: 'u-2',
        nombre: 'Beto',
        correo: 'beto@example.com',
        pendienteConfirmacion: true,
      }),
    ]

    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Ana')
    expect(texto).toContain('Beto')
    // Una sola fila la trae: si el badge se pintara en todas, el estado no
    // distinguiría nada.
    expect(texto.match(/Falta que acepte/g)).toHaveLength(1)
  })

  it('el aviso de arriba dice cuántas altas esperan, y desaparece sin pendientes', async () => {
    membersBackend = [
      miembro({ usuarioId: 'u-1', pendienteConfirmacion: true }),
      miembro({ usuarioId: 'u-2', correo: 'b@example.com', pendienteConfirmacion: true }),
      miembro({ usuarioId: 'u-3', correo: 'c@example.com' }),
    ]

    const conPendientes = await montar()
    // El punto del aviso: el alta NO falló.
    expect(conPendientes.text()).toContain('Falta que 2 personas acepten sumarse')
    expect(conPendientes.text()).toContain('El alta salió bien')

    conPendientes.unmount()
    montado = null

    membersBackend = [miembro()]
    const sinPendientes = await montar()
    expect(sinPendientes.text()).not.toContain('acepten sumarse')
  })

  it('la fila pendiente no ofrece tótem ni edición de roles (el backend las rechaza)', async () => {
    membersBackend = [miembro({ pendienteConfirmacion: true })]

    const wrapper = await montar()
    const botones = wrapper.findAll('button')
      .filter(b => b.attributes('title')?.includes('acepte sumarse'))

    expect(botones).toHaveLength(2)
    for (const b of botones) expect(b.attributes('disabled')).toBeDefined()
  })

  it('la fila confirmada conserva sus dos acciones habilitadas', async () => {
    membersBackend = [miembro()]

    const wrapper = await montar()
    const acciones = wrapper.findAll('button')
      .filter(b => /tótem compartido|Editar roles/i.test(b.attributes('title') ?? ''))

    expect(acciones).toHaveLength(2)
    for (const b of acciones) expect(b.attributes('disabled')).toBeUndefined()
  })
})

describe('configuracion/usuarios — el alta avisa cuál de los tres desenlaces fue', () => {
  /**
   * El modal se teleporta fuera del wrapper, así que el submit se dispara sobre
   * el `<form>` en `document.body`. Es la única forma de ejercitar el toast del
   * alta sin exponer la función desde la página solo para el test.
   */
  async function darDeAlta(wrapper: Awaited<ReturnType<typeof montar>>) {
    const nuevo = wrapper.findAll('button').find(b => b.text().includes('Nuevo usuario'))
    expect(nuevo, 'no se encontró el botón de alta').toBeTruthy()
    await nuevo!.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const form = document.querySelector('#alta-usuario-form')
    expect(form, 'no se encontró el formulario de alta').toBeTruthy()
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 0))
  }

  it('correo con cuenta previa: dice que falta que acepte, no que ya quedó agregado', async () => {
    respuestaAlta = {
      usuarioId: 'u-9',
      correo: 'beto@example.com',
      invitado: false,
      pendienteConfirmacion: true,
    }

    const wrapper = await montar()
    await darDeAlta(wrapper)

    const ultimo = toasts.at(-1)
    expect(ultimo?.title).toContain('beto@example.com')
    expect(ultimo?.title).toContain('acepte')
    expect(ultimo?.description).toContain('se suma cuando acepte')
    // La regresión concreta: el texto viejo de dos casos afirmaba lo contrario.
    expect(ultimo?.title).not.toContain('agregado al tenant')
    expect(ultimo?.description).not.toContain('con su contraseña de siempre')
  })

  it('correo sin cuenta: sigue siendo la invitación de siempre', async () => {
    respuestaAlta = {
      usuarioId: 'u-8',
      correo: 'nueva@example.com',
      invitado: true,
      pendienteConfirmacion: false,
    }

    const wrapper = await montar()
    await darDeAlta(wrapper)

    expect(toasts.at(-1)?.title).toContain('Invitación enviada')
    expect(toasts.at(-1)?.description).toContain('elegir su contraseña')
  })
})
