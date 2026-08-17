<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Rol {
  id: string
  nombre: string
}

interface Member {
  usuarioId: string
  nombre: string
  apellido: string
  correo: string
  /** La cuenta se usa como tótem compartido: en el salón siempre se pide PIN. */
  esTotem: boolean
  /**
   * El correo ya tenía cuenta, así que el alta **no la adopta**: le llegó un
   * mail y la persona todavía no aceptó sumarse. Hasta que acepte **no es
   * miembro** — aparece en la tabla igual porque, si no, el admin ve que el
   * alta "no hizo nada" y la repite.
   */
  pendienteConfirmacion: boolean
  roles: { rolId: string, nombre: string }[]
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const members = ref<Member[]>([])
const roles = ref<Rol[]>([])
const loading = ref(false)

const modalOpen = ref(false)
const saving = ref(false)
const editing = ref<Member | null>(null)
const seleccion = ref<string[]>([])

const roleItems = computed(() =>
  roles.value.map(r => ({ label: r.nombre, value: r.id })),
)

/**
 * Cuántas altas están esperando que la persona acepte. El badge por fila dice
 * *cuál*; este contador existe para el admin que acaba de dar de alta y busca
 * al usuario en la tabla: sin un aviso arriba, "está pero raro" se lee como
 * "el alta falló".
 */
const pendientes = computed(
  () => members.value.filter(m => m.pendienteConfirmacion).length,
)

async function cargar() {
  loading.value = true
  try {
    const [mem, rls] = await Promise.all([
      useApiFetch<Member[]>(`${apiUrl}/tenants/members`),
      useApiFetch<Rol[]>(`${apiUrl}/roles`),
    ])
    members.value = mem
    roles.value = rls
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar usuarios')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirEdicion(member: Member) {
  editing.value = member
  seleccion.value = member.roles.map(r => r.rolId)
  modalOpen.value = true
}

const formState = computed(() => ({ roles: seleccion.value }))

async function guardar() {
  if (!editing.value) return
  const member = editing.value
  const actuales = new Set(member.roles.map(r => r.rolId))
  const nuevos = new Set(seleccion.value)
  const agregar = [...nuevos].filter(id => !actuales.has(id))
  const quitar = [...actuales].filter(id => !nuevos.has(id))

  // Lo que el BACKEND tiene, que se va moviendo con cada request que sale
  // bien. No son N requests atómicas —no hay endpoint que las agrupe— así que
  // lo único honesto es no adelantarse: la pantalla muestra lo aplicado, no lo
  // pedido.
  const aplicados = new Set(actuales)

  saving.value = true
  try {
    // ⚠️ QUITAR primero, y el orden es la corrección. Desde el 2026-08-16
    // `DELETE /roles/:id/users/:userId` puede responder 400 (dejaría al tenant
    // sin ningún administrador), y ese 400 es alcanzable desde ESTA pantalla:
    // el único admin se edita a sí mismo y se destilda "Administrador".
    // Agregando primero, ese guardado dejaba los agregados aplicados y el
    // quitado no. Quitando primero, el camino que falla es el primero que
    // corre, así que lo normal es que NO quede nada a medias.
    for (const rolId of quitar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users/${member.usuarioId}`, {
        method: 'DELETE',
      })
      aplicados.delete(rolId)
    }
    for (const rolId of agregar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users`, {
        method: 'POST',
        body: { usuarioId: member.usuarioId },
      })
      aplicados.add(rolId)
    }
    toast.add({ title: 'Roles actualizados', color: 'success' })
    modalOpen.value = false
  }
  catch (e: unknown) {
    // El mensaje del backend llega tal cual: nombra la razón (el último admin)
    // y qué hacer antes de reintentar.
    const msg = apiErrorMsg(e, 'Error al guardar roles')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    // En los DOS caminos, y por eso va en el `finally`: si algo quedó a medias,
    // la fila tiene que mostrar lo que el backend tiene y no lo que se pidió.
    // También hace correcto el REINTENTO: `guardar()` recalcula `actuales`
    // desde `member.roles`, así que apretar Guardar de nuevo manda el diff que
    // falta y no el que ya se aplicó.
    const byId = new Map(roles.value.map(r => [r.id, r.nombre]))
    member.roles = [...aplicados].map(rolId => ({
      rolId,
      nombre: byId.get(rolId) ?? rolId,
    }))
    saving.value = false
  }
}

// ── Alta de usuario ─────────────────────────────────────────────────────────
const altaOpen = ref(false)
const creando = ref(false)
const alta = ref({ nombre: '', apellido: '', correo: '', rolIds: [] as string[] })

function abrirAlta() {
  alta.value = { nombre: '', apellido: '', correo: '', rolIds: [] }
  altaOpen.value = true
}

async function crearUsuario() {
  if (creando.value) return
  creando.value = true
  try {
    const res = await useApiFetch<{
      usuarioId: string
      correo: string
      invitado: boolean
      pendienteConfirmacion: boolean
    }>(`${apiUrl}/tenants/usuarios`, {
      method: 'POST',
      // `apellido` vacío se omite: `@IsOptional` no filtra el string vacío, así
      // que mandarlo guardaría '' en vez de NULL.
      body: { ...alta.value, apellido: alta.value.apellido || undefined },
    })

    altaOpen.value = false
    await cargar()

    // Tres desenlaces, no dos. El admin nunca ve una credencial: la persona
    // elige la suya desde el link (`invitado`) o ya tenía cuenta
    // (`pendienteConfirmacion`), y en ese caso el alta **no la adopta** —
    // queda esperando que ella acepte. El tercer caso es el alta que quedó
    // resuelta en el acto, sin mail de por medio.
    toast.add({
      title: res.invitado
        ? `Invitación enviada a ${res.correo}`
        : res.pendienteConfirmacion
          ? `Falta que ${res.correo} acepte`
          : 'Usuario agregado al tenant',
      description: res.invitado
        ? 'Le llega un link para elegir su contraseña. Vence en 7 días.'
        : res.pendienteConfirmacion
          ? 'Ese correo ya tenía cuenta. Le mandamos un mail avisándole que lo estás sumando: se suma cuando acepte, no antes.'
          : 'Ya tenía cuenta: entra con su contraseña de siempre.',
      color: 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al crear el usuario'), color: 'error' })
  }
  finally {
    creando.value = false
  }
}

onMounted(cargar)

// ── Tótem compartido ────────────────────────────────────────────────────────
const marcandoTotem = ref<string | null>(null)

/**
 * Marca o desmarca la cuenta como tótem del salón.
 *
 * Manda el estado **deseado**, no un "togglear": dos pestañas abiertas no
 * pueden dejar el marcador en el valor contrario al que muestran las dos.
 */
async function alternarTotem(member: Member) {
  if (marcandoTotem.value) return
  marcandoTotem.value = member.usuarioId
  const esTotem = !member.esTotem
  try {
    await useApiFetch(`${apiUrl}/tenants/members/${member.usuarioId}/totem`, {
      method: 'PATCH',
      body: { esTotem },
    })
    member.esTotem = esTotem
    toast.add({
      title: esTotem
        ? 'Ahora es un tótem compartido: en el salón siempre va a pedir PIN'
        : 'Ya no es un tótem compartido',
      color: 'success',
    })
  }
  catch (e: unknown) {
    // El 409 de "está vinculada a un garzón" es accionable y hay que mostrarlo
    // tal cual: dice a quién desvincular primero.
    toast.add({ title: apiErrorMsg(e, 'No se pudo cambiar el modo'), color: 'error' })
  }
  finally {
    marcandoTotem.value = null
  }
}

const columns: TableColumn<Member>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'roles', header: 'Roles' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Usuarios"
      description="Da de alta usuarios del tenant y asigna sus roles."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirAlta">
          Nuevo usuario
        </UButton>
      </template>
    </CrudPageHeader>

    <!-- El alta que espera confirmación es el único caso en que la tabla no
         refleja lo que el admin acaba de hacer. Sin decirlo acá arriba —donde
         se mira después de crear— el badge de la fila llega tarde: para
         entonces ya repitió el alta o dio por hecho que falló. -->
    <UAlert
      v-if="pendientes"
      color="info"
      variant="subtle"
      icon="i-lucide-mail-check"
      :title="pendientes === 1
        ? 'Falta que 1 persona acepte sumarse'
        : `Falta que ${pendientes} personas acepten sumarse`"
      description="El alta salió bien: ya les llegó un mail avisando que las estás sumando a esta empresa. Recién cuando aceptan pasan a ser miembros y sus roles empiezan a valer."
    />

    <CrudTable :data="members" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="flex items-center gap-2">
          <CrudListItem
            :title="`${row.original.nombre} ${row.original.apellido}`"
            :subtitle="row.original.correo"
          />
          <!-- Se marca en la fila y no en un drawer aparte: es una propiedad de
               la cuenta, y quien la administra tiene que poder VER de un vistazo
               cuáles de sus cuentas son dispositivos compartidos. -->
          <UBadge
            v-if="row.original.esTotem"
            color="warning"
            variant="subtle"
            size="xs"
            icon="i-lucide-monitor"
          >
            Tótem
          </UBadge>
          <!-- Va pegado al nombre y no en una columna aparte: lo que el admin
               necesita saber es que ESA persona todavía no entra, y lo busca
               por nombre. -->
          <UBadge
            v-if="row.original.pendienteConfirmacion"
            color="info"
            variant="subtle"
            size="xs"
            icon="i-lucide-clock"
            title="Le llegó un mail avisándole que la estás sumando. Todavía no aceptó, así que aún no es miembro."
          >
            Falta que acepte
          </UBadge>
        </div>
      </template>

        <template #roles-cell="{ row }">
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="rol in row.original.roles"
              :key="rol.rolId"
              color="primary"
              variant="subtle"
              size="xs"
            >
              {{ rol.nombre }}
            </UBadge>
            <span
              v-if="!row.original.roles.length"
              class="text-xs text-muted"
            >
              Sin roles
            </span>
          </div>
        </template>

        <!-- Las dos acciones escriben sobre la membresía, y quien todavía no
             aceptó no la tiene: el backend rechaza ambas. Se deshabilitan con
             el motivo a la vista en vez de dejar que el admin las apriete para
             recibir un error que no explica nada. -->
        <template #acciones-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <UButton
              :icon="row.original.esTotem ? 'i-lucide-monitor-off' : 'i-lucide-monitor'"
              color="neutral"
              variant="ghost"
              :loading="marcandoTotem === row.original.usuarioId"
              :disabled="row.original.pendienteConfirmacion"
              :title="row.original.pendienteConfirmacion
                ? 'Se puede configurar cuando acepte sumarse'
                : row.original.esTotem
                  ? 'Dejar de usarla como tótem compartido'
                  : 'Usar esta cuenta como tótem compartido'"
              @click="alternarTotem(row.original)"
            />
            <UButton
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
              :disabled="row.original.pendienteConfirmacion"
              :title="row.original.pendienteConfirmacion
                ? 'Sus roles se pueden editar cuando acepte sumarse'
                : 'Editar roles'"
              @click="abrirEdicion(row.original)"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay usuarios en este tenant.
        </div>
      </template>
    </CrudTable>

    <UModal v-model:open="altaOpen" title="Nuevo usuario">
      <template #body>
        <UForm id="alta-usuario-form" :state="alta" class="space-y-4" @submit="crearUsuario">
          <UFormField label="Nombre" required>
            <UInput v-model="alta.nombre" :maxlength="100" autofocus class="w-full" />
          </UFormField>
          <UFormField label="Apellido">
            <UInput v-model="alta.apellido" :maxlength="100" class="w-full" />
          </UFormField>
          <UFormField label="Correo" required>
            <UInput v-model="alta.correo" type="email" :maxlength="100" class="w-full" />
          </UFormField>
          <!-- Obligatorio: un usuario sin rol entra y no ve nada. -->
          <UFormField label="Roles" required>
            <USelectMenu
              v-model="alta.rolIds"
              :items="roleItems"
              multiple
              value-key="value"
              placeholder="Selecciona al menos un rol"
              class="w-full"
            />
          </UFormField>
          <p class="text-sm text-muted">
            Si el correo <strong>ya tiene cuenta</strong>, le llega un mail
            avisándole que la estás sumando: se suma
            <strong>recién cuando acepta</strong>, con los roles que elijas acá.
            Si <strong>no tiene cuenta</strong>, le llega un
            <strong>link por mail</strong> para que elija su contraseña. Vos no
            la ves nunca.
          </p>
        </UForm>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton color="neutral" variant="ghost" @click="() => { altaOpen = false }">
            Cancelar
          </UButton>
          <UButton
            type="submit"
            form="alta-usuario-form"
            :loading="creando"
            :disabled="!alta.nombre || !alta.correo || alta.rolIds.length === 0"
          >
            Crear
          </UButton>
        </AppModalFooter>
      </template>
    </UModal>


    <UModal
      v-model:open="modalOpen"
      :title="editing ? `Roles de ${editing.nombre}` : 'Roles'"
    >
      <template #body>
        <UForm
          id="usuario-roles-form"
          :state="formState"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Roles">
            <USelectMenu
              v-model="seleccion"
              :items="roleItems"
              multiple
              value-key="value"
              placeholder="Selecciona roles"
              class="w-full"
            />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="() => { modalOpen = false }"
          >
            Cancelar
          </UButton>
          <UButton
            type="submit"
            form="usuario-roles-form"
            :loading="saving"
          >
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
