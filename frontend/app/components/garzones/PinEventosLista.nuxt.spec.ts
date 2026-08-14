// @vitest-environment nuxt
//
// Este componente lo montan tres pantallas (perfil, ficha del garzón, salón):
// un `tipo` que el backend sume y este front todavía no conozca no puede
// tirar la card entera, porque el `v-for` vive DENTRO del componente y ese
// throw se llevaría puesto todo lo que esté alrededor en las tres pantallas.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PinEventosLista from './PinEventosLista.vue'
import type { EventoPin } from '~/composables/useGarzones'

describe('PinEventosLista', () => {
  it('sin eventos, dice que todavía no hubo cambios', async () => {
    const wrapper = await mountSuspended(PinEventosLista, { props: { eventos: [] } })

    expect(wrapper.text()).toContain('Todavía no hubo cambios de PIN')
  })

  it('traduce cada tipo conocido a su texto', async () => {
    const eventos: EventoPin[] = [
      { id: 'e1', tipo: 'emitido_en_alta', usuarioNombre: 'admin.paris', creadoEl: '2026-08-01T10:00:00.000Z' },
      { id: 'e2', tipo: 'regenerado_por_encargado', usuarioNombre: 'admin.paris', creadoEl: '2026-08-02T10:00:00.000Z' },
      { id: 'e3', tipo: 'invalidado_por_encargado', usuarioNombre: 'admin.paris', creadoEl: '2026-08-03T10:00:00.000Z' },
      { id: 'e4', tipo: 'invalidado_por_vinculo', usuarioNombre: 'admin.paris', creadoEl: '2026-08-04T10:00:00.000Z' },
      { id: 'e5', tipo: 'fijado_por_garzon', usuarioNombre: null, creadoEl: '2026-08-05T10:00:00.000Z' },
    ]

    const wrapper = await mountSuspended(PinEventosLista, { props: { eventos } })

    expect(wrapper.text()).toContain('admin.paris emitió el PIN al dar de alta')
    expect(wrapper.text()).toContain('admin.paris generó un PIN nuevo')
    expect(wrapper.text()).toContain('admin.paris invalidó el PIN')
    expect(wrapper.text()).toContain('El PIN quedó sin efecto al vincular la cuenta (admin.paris)')
    expect(wrapper.text()).toContain('Puso su PIN')
  })

  it('usuarioNombre null en un evento de encargado se lee como cuenta dada de baja', async () => {
    const eventos: EventoPin[] = [
      { id: 'e1', tipo: 'regenerado_por_encargado', usuarioNombre: null, creadoEl: '2026-08-01T10:00:00.000Z' },
    ]

    const wrapper = await mountSuspended(PinEventosLista, { props: { eventos } })

    expect(wrapper.text()).toContain('Una cuenta dada de baja generó un PIN nuevo')
  })

  // El caso que motiva este archivo: un `tipo` que el `Record` no cubre en
  // runtime (el backend sumó uno nuevo, el front todavía no). Sin fallback,
  // `TEXTO[e.tipo](...)` es `TypeError: TEXTO[e.tipo] is not a function` y
  // el throw dentro del `v-for` se lleva puesta la card completa — acá se
  // prueba que la fila se pinta con un texto neutro en vez de reventar.
  it('un tipo desconocido no revienta la lista: se pinta con un texto neutro', async () => {
    const eventos = [
      { id: 'e1', tipo: 'un_tipo_que_no_existe_todavia', usuarioNombre: 'admin.paris', creadoEl: '2026-08-01T10:00:00.000Z' },
    ] as unknown as EventoPin[]

    const wrapper = await mountSuspended(PinEventosLista, { props: { eventos } })

    expect(wrapper.text()).toContain('Hubo un cambio en el PIN')
  })
})
