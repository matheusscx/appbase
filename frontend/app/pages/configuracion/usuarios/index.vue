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

  saving.value = true
  try {
    for (const rolId of agregar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users`, {
        method: 'POST',
        body: { usuarioId: member.usuarioId },
      })
    }
    for (const rolId of quitar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users/${member.usuarioId}`, {
        method: 'DELETE',
      })
    }
    const byId = new Map(roles.value.map(r => [r.id, r.nombre]))
    member.roles = seleccion.value.map(rolId => ({
      rolId,
      nombre: byId.get(rolId) ?? rolId,
    }))
    toast.add({ title: 'Roles actualizados', color: 'success' })
    modalOpen.value = false
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar roles')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
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

/**
 * La temporal se muestra **una sola vez**: el backend la genera, devuelve el
 * claro en la respuesta del alta y guarda solo el hash. Mismo patrón que el PIN
 * del garzón.
 */
const temporalOpen = ref(false)
const temporal = ref<{ correo: string, contrasena: string }>({
  correo: '',
  contrasena: '',
})

async function crearUsuario() {
  if (creando.value) return
  creando.value = true
  try {
    const res = await useApiFetch<{
      usuarioId: string
      correo: string
      contrasenaTemporal?: string
    }>(`${apiUrl}/tenants/usuarios`, {
      method: 'POST',
      // `apellido` vacío se omite: `@IsOptional` no filtra el string vacío, así
      // que mandarlo guardaría '' en vez de NULL.
      body: { ...alta.value, apellido: alta.value.apellido || undefined },
    })

    altaOpen.value = false
    await cargar()

    // Sin `contrasenaTemporal` el correo ya existía: se asoció a este tenant y
    // su contraseña no se tocó, así que no hay nada que mostrar ni entregar.
    if (res.contrasenaTemporal) {
      temporal.value = { correo: res.correo, contrasena: res.contrasenaTemporal }
      temporalOpen.value = true
    }
    else {
      toast.add({
        title: 'Usuario agregado al tenant',
        description: 'Ya tenía cuenta: entra con su contraseña de siempre.',
        color: 'success',
      })
    }
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

        <template #acciones-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <UButton
              :icon="row.original.esTotem ? 'i-lucide-monitor-off' : 'i-lucide-monitor'"
              color="neutral"
              variant="ghost"
              :loading="marcandoTotem === row.original.usuarioId"
              :title="row.original.esTotem
                ? 'Dejar de usarla como tótem compartido'
                : 'Usar esta cuenta como tótem compartido'"
              @click="alternarTotem(row.original)"
            />
            <UButton
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
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
            Si el correo ya tiene cuenta, se suma a este tenant conservando su
            contraseña, y le quedan <strong>los roles que elijas acá</strong>.
            Si no, el sistema genera una contraseña temporal que vas a ver
            <strong>una sola vez</strong>.
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

    <UModal v-model:open="temporalOpen" :title="`Contraseña de ${temporal.correo}`">
      <template #body>
        <div class="space-y-4">
          <code class="block rounded bg-elevated px-3 py-3 text-center text-2xl font-semibold tracking-widest">{{ temporal.contrasena }}</code>
          <p class="text-sm text-warning">
            <UIcon name="i-lucide-triangle-alert" class="size-4 align-text-bottom" />
            Guardala ahora — <strong>no se vuelve a mostrar</strong>. Pasásela a
            la persona: el sistema le va a pedir cambiarla antes de dejarla
            entrar.
          </p>
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton label="Entendido" @click="() => { temporalOpen = false }" />
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
