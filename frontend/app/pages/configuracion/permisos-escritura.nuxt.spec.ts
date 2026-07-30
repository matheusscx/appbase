// @vitest-environment nuxt
//
// Un solo archivo para las cuatro pantallas porque el modo de falla es UNO y es
// el mismo en todas: colapsar los permisos en un `puedeEscribir` único, o gatear
// unos controles y olvidar otros. Una tabla lo hace visible de un vistazo; cuatro
// specs casi idénticos lo esconderían en la duplicación.
//
// Ver `terceros.nuxt.spec.ts` para por qué el entorno `nuxt` va por archivo.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { DOMWrapper } from '@vue/test-utils'
import SalonPlano from '~/components/salones/SalonPlano.vue'
import Configuracion from '~/pages/configuracion.vue'
import Garzones from './garzones.vue'
import Impresoras from './impresoras.vue'
import Salones from './salones.vue'
import Turnos from './turnos.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    // `permisos`/`loading`/`fetchPermisos` los usa el `onMounted` de
    // `configuracion.vue`, que se monta en el último bloque de este archivo.
    get permisos() { return permisos },
    get loading() { return false },
    fetchPermisos: () => Promise.resolve(),
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

// Las páginas leen por composable, no por `useApiFetch` directo: se mockea el
// composable auto-importado, que es lo que la página realmente resuelve.
const GARZON = {
  id: 'g-1',
  nombre: 'Ana Torres',
  activo: true,
  tipo: 'garzon',
  creadoEl: '',
  actualizadoEl: '',
}
mockNuxtImport('useGarzones', () => {
  return () => ({ listar: () => Promise.resolve([GARZON]) })
})

const IMPRESORA = {
  id: 'i-1',
  nombre: 'Cocina',
  rol: 'comanda',
  tipoConexion: 'red',
  host: '192.168.1.50',
  puerto: 9100,
  nombreCola: null,
  activo: true,
}
mockNuxtImport('useImpresoras', () => {
  return () => ({ listar: () => Promise.resolve([IMPRESORA]) })
})

const SALON = {
  id: 's-1',
  nombre: 'Principal',
  mesas: [{
    id: 'm-1',
    nombre: 'Mesa 1',
    posX: '0.50000',
    posY: '0.50000',
    forma: 'cuadrada',
    tamano: 'mediano',
    cuentasAbiertas: 0,
    ocupada: false,
  }],
}
mockNuxtImport('useSalones', () => {
  return () => ({ listarSalones: () => Promise.resolve([SALON]) })
})

const TURNO = {
  id: 't-1',
  nombre: 'Brunch',
  horaInicio: '08:00',
  horaFin: '12:00',
  activo: true,
  creadoEl: '',
  actualizadoEl: '',
}
mockNuxtImport('useTurnos', () => {
  return () => ({ listar: () => Promise.resolve([TURNO]) })
})

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>

async function montar(componente: Parameters<typeof mountSuspended>[0]) {
  const wrapper = await mountSuspended(componente)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneBotonConTexto(wrapper: Wrapper, texto: string) {
  return wrapper.findAll('button').some((b: DOMWrapper<Element>) => b.text().includes(texto))
}

/**
 * Por `title`, no por la clase del icono: el icono lo renderiza `UIcon` en un
 * hijo y en el entorno de test no siempre resuelve, así que consultarlo ataría
 * el test al bundle de iconos en vez de al control.
 */
function tieneControl(wrapper: Wrapper, title: string) {
  return wrapper.findAll(`[title="${title}"]`).length > 0
}

interface Caso {
  pagina: string
  componente: Parameters<typeof mountSuspended>[0]
  modulo: string
  /** Botones con texto que pegan a un endpoint `Crear`. */
  crear: string[]
  /** Controles solo-icono (`title`) que pegan a un endpoint `Actualizar`. */
  actualizar: string[]
  /** Controles solo-icono (`title`) que pegan a un endpoint `Eliminar`. */
  eliminar: string[]
}

// Garzones, salones y turnos NO tienen módulo propio: sus rutas piden permisos
// de `Salones`. `Salones:Operar` no aparece en ninguna: es de la operación
// (cuentas, comandas, identificar garzón), no de estas pantallas.
const CASOS: Caso[] = [
  {
    pagina: 'garzones',
    componente: Garzones,
    modulo: 'Salones',
    crear: ['Nuevo garzón'],
    // Regenerar PIN es `PATCH :id/pin`, no un permiso aparte.
    actualizar: ['Editar', 'Regenerar PIN'],
    eliminar: ['Eliminar'],
  },
  {
    pagina: 'impresoras',
    componente: Impresoras,
    modulo: 'Impresoras',
    crear: ['Nueva impresora'],
    actualizar: ['Editar'],
    eliminar: ['Eliminar'],
  },
  {
    pagina: 'salones',
    componente: Salones,
    modulo: 'Salones',
    // Agregar mesa es `POST /salones/:id/mesas`: `Crear`, igual que el salón.
    crear: ['Nuevo salón', 'Agregar mesa'],
    actualizar: ['Editar salón'],
    eliminar: ['Eliminar salón'],
  },
  {
    pagina: 'turnos',
    componente: Turnos,
    modulo: 'Salones',
    crear: ['Nuevo turno'],
    actualizar: ['Editar'],
    eliminar: ['Eliminar'],
  },
]

describe.each(CASOS)('$pagina — cada control con el permiso de SU endpoint', (caso) => {
  beforeEach(() => {
    esAdmin = false
    permisos = []
  })

  function esperar(wrapper: Wrapper, opts: { crear: boolean, actualizar: boolean, eliminar: boolean }) {
    for (const texto of caso.crear) {
      expect(tieneBotonConTexto(wrapper, texto), texto).toBe(opts.crear)
    }
    for (const title of caso.actualizar) {
      expect(tieneControl(wrapper, title), title).toBe(opts.actualizar)
    }
    for (const title of caso.eliminar) {
      expect(tieneControl(wrapper, title), title).toBe(opts.eliminar)
    }
  }

  it('solo lectura: ningún control de escritura', async () => {
    permisos = [`${caso.modulo}:Leer`]

    const wrapper = await montar(caso.componente)

    esperar(wrapper, { crear: false, actualizar: false, eliminar: false })
  })

  it('solo `Crear`: aparece el alta y NADA más', async () => {
    permisos = [`${caso.modulo}:Leer`, `${caso.modulo}:Crear`]

    const wrapper = await montar(caso.componente)

    esperar(wrapper, { crear: true, actualizar: false, eliminar: false })
  })

  it('solo `Actualizar`: aparece editar sin crear ni eliminar', async () => {
    // El caso que un `puedeEscribir` único se comería: los tres permisos son
    // distintos en el backend y hay roles que tienen uno solo.
    permisos = [`${caso.modulo}:Leer`, `${caso.modulo}:Actualizar`]

    const wrapper = await montar(caso.componente)

    esperar(wrapper, { crear: false, actualizar: true, eliminar: false })
  })

  it('solo `Eliminar`: aparece la papelera y nada más', async () => {
    permisos = [`${caso.modulo}:Leer`, `${caso.modulo}:Eliminar`]

    const wrapper = await montar(caso.componente)

    esperar(wrapper, { crear: false, actualizar: false, eliminar: true })
  })

  it('el admin del tenant ve los tres sin permisos listados', async () => {
    esAdmin = true

    const wrapper = await montar(caso.componente)

    esperar(wrapper, { crear: true, actualizar: true, eliminar: true })
  })
})

describe('impresoras — el switch de activo se deshabilita, no se esconde', () => {
  beforeEach(() => {
    esAdmin = false
    permisos = []
  })

  it('sin `Actualizar` el switch sigue visible pero no se puede tocar', async () => {
    // Esconderlo le borraría a quien puede leer el dato de si la impresora está
    // activa: el control además MUESTRA estado.
    permisos = ['Impresoras:Leer']

    const wrapper = await montar(Impresoras)
    const sw = wrapper.find('[aria-label="Activar o desactivar impresora"]')

    expect(sw.exists()).toBe(true)
    expect(sw.attributes('disabled')).toBeDefined()
  })

  it('con `Actualizar` el switch queda operable', async () => {
    permisos = ['Impresoras:Leer', 'Impresoras:Actualizar']

    const wrapper = await montar(Impresoras)
    const sw = wrapper.find('[aria-label="Activar o desactivar impresora"]')

    expect(sw.attributes('disabled')).toBeUndefined()
  })
})

describe('salones — el plano es una escritura más', () => {
  beforeEach(() => {
    esAdmin = false
    permisos = []
  })

  it('sin `Actualizar` el plano no es editable', async () => {
    // `editable` habilita arrastrar (`PATCH :id/layout`) y el doble-click que
    // abre el drawer de la mesa (`PATCH /mesas/:id`). Sin gate, el usuario
    // arrastra mesas y descubre el 403 recién al soltar.
    permisos = ['Salones:Leer']

    const wrapper = await montar(Salones)

    expect(wrapper.findComponent(SalonPlano).props('editable')).toBe(false)
  })

  it('con `Actualizar` el plano es editable', async () => {
    permisos = ['Salones:Leer', 'Salones:Actualizar']

    const wrapper = await montar(Salones)

    expect(wrapper.findComponent(SalonPlano).props('editable')).toBe(true)
  })

  /**
   * Borrar una mesa vive dentro del drawer de edición, que el drawer teletransporta
   * fuera del wrapper: hay que abrirlo por el evento del plano —el camino real del
   * doble-click— y mirar el `body`.
   */
  async function abrirDrawerDeMesa() {
    const wrapper = await montar(Salones)
    wrapper.findComponent(SalonPlano).vm.$emit('edit', SALON.mesas[0])
    await new Promise(r => setTimeout(r, 50))
    const eliminar = [...document.body.querySelectorAll('button')]
      .filter(b => b.textContent?.trim() === 'Eliminar').length
    wrapper.unmount()
    return eliminar
  }

  it('con `Actualizar` pero sin `Eliminar` el drawer de mesa no ofrece borrarla', async () => {
    // `DELETE /mesas/:id` pide `Eliminar`, no `Actualizar`: el permiso del
    // endpoint, no el del drawer que lo contiene.
    permisos = ['Salones:Leer', 'Salones:Actualizar']

    expect(await abrirDrawerDeMesa()).toBe(0)
  })

  it('con `Eliminar` el drawer de mesa ofrece borrarla', async () => {
    permisos = ['Salones:Leer', 'Salones:Actualizar', 'Salones:Eliminar']

    expect(await abrirDrawerDeMesa()).toBe(1)
  })
})

describe('el menú de configuración no puede pedir más que la pantalla', () => {
  /**
   * El gate por control no sirve de nada si el link nunca aparece. Estas cuatro
   * entradas pedían `Crear` —el resto del menú pide `Leer`—, así que quien tenía
   * `Actualizar` o `Eliminar` no llegaba a la pantalla donde sí podía trabajar.
   *
   * De los tres tests, los DOS PRIMEROS son los que distinguen `Leer` de `Crear`;
   * el tercero pasa igual con el gate roto y está por otra razón, dicha ahí.
   */
  it('con solo `Leer` las cuatro entradas están en el menú', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Impresoras:Leer']

    const wrapper = await montar(Configuracion)
    const links = [...wrapper.element.querySelectorAll('a')]
      .map(a => a.textContent?.trim())

    expect(links).toEqual(expect.arrayContaining([
      'Salones', 'Garzones', 'Turnos', 'Impresoras',
    ]))
    wrapper.unmount()
  })

  it('el rol del bug —puede editar, no crear— ve las entradas', async () => {
    // El caso concreto que motivó el fix, escrito aparte del anterior porque es
    // un rol realista y no un mínimo teórico: alguien que mantiene salones y
    // turnos sin poder darlos de alta.
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Actualizar', 'Impresoras:Leer', 'Impresoras:Actualizar']

    const wrapper = await montar(Configuracion)
    const links = [...wrapper.element.querySelectorAll('a')]
      .map(a => a.textContent?.trim())

    expect(links).toEqual(expect.arrayContaining([
      'Salones', 'Garzones', 'Turnos', 'Impresoras',
    ]))
    wrapper.unmount()
  })

  it('sin permiso del módulo la entrada no aparece', async () => {
    // Este NO distingue `Leer` de `Crear` —sin ninguno de los dos, ambos gates
    // dan `false`—: lo que fija es que el gate siga siendo un gate y que un
    // permiso de otro módulo no filtre entradas ajenas.
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await montar(Configuracion)
    const links = [...wrapper.element.querySelectorAll('a')]
      .map(a => a.textContent?.trim())

    expect(links).not.toContain('Salones')
    expect(links).not.toContain('Impresoras')
    wrapper.unmount()
  })
})
