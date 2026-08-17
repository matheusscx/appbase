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

// ── Editor de roles ─────────────────────────────────────────────────────────
/** Los roles que ofrece `GET /roles`. */
let rolesBackend = [{ id: 'r-1', nombre: 'Cajero' }]
/** Cada asignación/desasignación recibida, EN ORDEN: la sonda del bug. */
let opsRoles: { metodo: 'POST' | 'DELETE', rolId: string }[] = []
/**
 * Los `rolId` cuyo `DELETE` responde 400 — el guard del último administrador
 * (`roles.service.ts` → `removeUser`), alcanzable desde esta pantalla cuando el
 * único admin se destilda a sí mismo.
 */
let deleteRechaza = new Set<string>()

function errorApi(message: string): Error {
  return Object.assign(new Error('Request failed'), { data: { message } })
}

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
    // ANTES del `/roles` genérico: `/roles/r-1/users` también lo contiene, y
    // sin esta rama las escrituras "salían bien" devolviendo el listado.
    if (url.includes('/roles/') && url.includes('/users')) {
      const rolId = url.split('/roles/')[1]?.split('/')[0] ?? ''
      const metodo = opts?.method === 'DELETE' ? 'DELETE' : 'POST'
      opsRoles.push({ metodo, rolId })
      if (metodo === 'DELETE' && deleteRechaza.has(rolId)) {
        return Promise.reject(
          errorApi(
            'No se puede quitar ese rol: dejaría a la empresa sin ningún '
            + 'administrador, y no hay forma de volver a asignar uno desde la '
            + 'aplicación. Dale el rol de administrador a otra persona primero.',
          ),
        )
      }
      return Promise.resolve({})
    }
    if (url.includes('/roles')) return Promise.resolve(rolesBackend)
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
  rolesBackend = [{ id: 'r-1', nombre: 'Cajero' }]
  opsRoles = []
  deleteRechaza = new Set()
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

/**
 * El editor de roles aplica N requests que **no son atómicas** —no hay endpoint
 * que las agrupe— y desde el 2026-08-16 una de ellas puede fallar:
 * `DELETE /roles/:id/users/:userId` responde 400 si dejaría al tenant sin
 * ningún administrador, y ese 400 es alcanzable desde acá (el único admin se
 * edita a sí mismo y se destilda "Administrador").
 *
 * Lo que estos tests fijan es que un guardado a medias no mienta: la fila
 * muestra lo que el backend TIENE, no lo que se pidió.
 */
describe('configuracion/usuarios — un guardado de roles a medias no miente', () => {
  /** Abre el editor de roles del primer miembro y devuelve el `<form>`. */
  async function abrirEditor(wrapper: Awaited<ReturnType<typeof montar>>) {
    const boton = wrapper.findAll('button')
      .find(b => b.attributes('title') === 'Editar roles')
    expect(boton, 'botón "Editar roles"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 30))
    const form = document.body.querySelector('#usuario-roles-form')
    expect(form, 'formulario de roles en el body').toBeTruthy()
    return form as HTMLFormElement
  }

  /** Elige exactamente estos roles en el `USelectMenu` y guarda. */
  async function elegirYGuardar(
    wrapper: Awaited<ReturnType<typeof montar>>,
    nombres: string[],
  ) {
    const form = await abrirEditor(wrapper)
    const trigger = form.querySelector('button')
    expect(trigger, 'trigger del selector de roles').toBeTruthy()
    trigger!.click()
    await new Promise(r => setTimeout(r, 40))

    for (const nombre of nombres) {
      const opcion = [...document.body.querySelectorAll('[role="option"]')]
        .find(o => o.textContent?.trim() === nombre)
      expect(opcion, `opción "${nombre}" en el selector`).toBeTruthy()
      ;(opcion as HTMLElement).click()
      await new Promise(r => setTimeout(r, 20))
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 60))
  }

  it('quita ANTES de agregar: el camino que puede fallar corre primero', async () => {
    rolesBackend = [{ id: 'r-1', nombre: 'Cajero' }, { id: 'r-2', nombre: 'Supervisor' }]
    membersBackend = [miembro()]
    const wrapper = await montar()

    // Destilda Cajero y tilda Supervisor en el mismo guardado.
    await elegirYGuardar(wrapper, ['Cajero', 'Supervisor'])

    expect(opsRoles).toEqual([
      { metodo: 'DELETE', rolId: 'r-1' },
      { metodo: 'POST', rolId: 'r-2' },
    ])
  })

  it('si el DELETE falla, el POST no llega a salir y la fila sigue mostrando el rol viejo', async () => {
    rolesBackend = [{ id: 'r-1', nombre: 'Cajero' }, { id: 'r-2', nombre: 'Supervisor' }]
    membersBackend = [miembro()]
    deleteRechaza = new Set(['r-1'])
    const wrapper = await montar()

    await elegirYGuardar(wrapper, ['Cajero', 'Supervisor'])

    // Nada quedó a medias: el 400 cortó antes de agregar nada.
    expect(opsRoles).toEqual([{ metodo: 'DELETE', rolId: 'r-1' }])
    // Y la fila dice la verdad. Antes del 2026-08-16 el orden era el inverso y
    // "Supervisor" quedaba aplicado en el backend sin que la pantalla lo
    // mostrara nunca.
    expect(wrapper.text()).toContain('Cajero')
    expect(wrapper.text()).not.toContain('Supervisor')
    // El mensaje del backend llega tal cual: dice la razón y qué hacer.
    expect(toasts.some(t => t.color === 'error' && t.title?.includes('sin ningún administrador'))).toBe(true)
  })

  it('si una baja pasa y la siguiente falla, la fila muestra EXACTAMENTE lo que quedó', async () => {
    // El caso que el reordenamiento solo no arregla, y que obliga a que el
    // estado local salga de lo aplicado y no de lo pedido.
    rolesBackend = [{ id: 'r-1', nombre: 'Cajero' }, { id: 'r-2', nombre: 'Supervisor' }]
    membersBackend = [miembro({
      roles: [{ rolId: 'r-1', nombre: 'Cajero' }, { rolId: 'r-2', nombre: 'Supervisor' }],
    })]
    deleteRechaza = new Set(['r-2'])
    const wrapper = await montar()

    // Destilda los dos.
    await elegirYGuardar(wrapper, ['Cajero', 'Supervisor'])

    expect(opsRoles).toEqual([
      { metodo: 'DELETE', rolId: 'r-1' },
      { metodo: 'DELETE', rolId: 'r-2' },
    ])
    // Cajero se fue, Supervisor no: eso es lo que la fila tiene que decir.
    expect(wrapper.text()).not.toContain('Cajero')
    expect(wrapper.text()).toContain('Supervisor')
  })
})
