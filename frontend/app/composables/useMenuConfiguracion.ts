export interface EntradaConfiguracion {
  label: string
  icon: string
  to: string
  /** Una frase de lo que se hace ahí: la muestra el índice de Configuración (auditoría UX 07.34). */
  descripcion: string
}

export interface GrupoConfiguracion {
  label: string
  items: EntradaConfiguracion[]
}

/**
 * Los grupos de Configuración y lo que cada persona ve de ellos. Lo leen el menú lateral y el
 * índice de `/configuracion`: un solo lugar para el gate de cada entrada.
 *
 * Agrupado por lo que configura, en el orden en que se arma un local (owner, 2026-10-02). Cada
 * entrada lleva su propio gate —el de la ruta, exacto—, y un grupo sin entradas visibles se saca
 * entero: el menú dibuja el separador y el encabezado aunque la lista venga vacía.
 */
export function useMenuConfiguracion() {
  const permissionsStore = usePermissionsStore()

  return computed<GrupoConfiguracion[]>(() => {
    const admin = permissionsStore.esAdmin
    // `Leer`, no `Crear`: lo que la pantalla pide para abrirse es el permiso de
    // lectura. Con `Crear` el link quedaba escondido para quien solo tiene
    // `Actualizar` o `Eliminar` —que sí puede trabajar ahí—, el mismo colapso de
    // permisos que los gates por control vienen a evitar. Sin atajo para el admin:
    // `mis-permisos` le trae solo los módulos que su tenant contrató (owner, 2026-10-15).
    const lee = (modulo: string) => permissionsStore.can(modulo, 'Leer')
    const e = (label: string, icon: string, to: string, descripcion: string): EntradaConfiguracion =>
      ({ label, icon, to: `/configuracion/${to}`, descripcion })

    const grupos: { label: string, items: (EntradaConfiguracion | false)[] }[] = [
      {
        label: 'Mi cuenta',
        items: [
          e('Perfil', 'i-lucide-circle-user', 'perfil', 'Tus datos, el tema, tu contraseña y tu PIN.'),
        ],
      },
      {
        label: 'Organización',
        items: [
          admin && e('Empresa', 'i-lucide-building-2', 'empresa', 'Nombre, contacto y hora en que termina el día de tu local.'),
          admin && e('Razones sociales', 'i-lucide-file-text', 'razones-sociales', 'Los datos legales con que se emiten tus documentos.'),
          // La ve todo admin del tenant, el mismo gate de la ruta: desde que la venta emite su boleta,
          // prender la emisión y emitir las pendientes es del dueño del local, no del superadmin.
          admin && e('Boleta electrónica', 'i-lucide-receipt-text', 'boleta-electronica', 'Activa la emisión y revisa las boletas pendientes.'),
          admin && e('Usuarios', 'i-lucide-users', 'usuarios', 'Las personas de tu local y los roles que tiene cada una.'),
          admin && e('Roles y permisos', 'i-lucide-shield-check', 'roles', 'Qué puede hacer cada rol en cada módulo.'),
        ],
      },
      {
        label: 'Catálogo',
        items: [
          lee('Items') && e('Productos', 'i-lucide-archive', 'items', 'Lo que vendes: productos, servicios y suscripciones, con su precio y su costo.'),
          admin && e('Categorías', 'i-lucide-tag', 'categorias', 'Ordena tu catálogo y define a qué impresora va cada comanda.'),
          admin && e('Grupos de modificadores', 'i-lucide-list-plus', 'grupos-modificadores', 'Las opciones que el cliente elige en un plato: término, extras, salsas.'),
        ],
      },
      {
        label: 'Precios',
        items: [
          admin && e('Preferencias financieras', 'i-lucide-sliders-horizontal', 'preferencias-financieras', 'Cómo se calculan los precios y los descuentos.'),
          admin && e('Impuestos', 'i-lucide-badge-percent', 'impuestos', 'Los impuestos que se aplican a tus ventas.'),
          admin && e('Descuentos', 'i-lucide-trending-down', 'descuentos', 'Rebajas que se aplican a un producto, a una venta o a un cliente.'),
          admin && e('Recargos', 'i-lucide-trending-up', 'recargos', 'Cobros adicionales sobre un producto o una venta.'),
          admin && e('Promociones', 'i-lucide-megaphone', 'promociones', 'Ofertas por tiempo limitado, como un 2x1.'),
          admin && e('Monedas', 'i-lucide-dollar-sign', 'monedas', 'Las monedas con que vendes y su tasa de cambio.'),
        ],
      },
      {
        label: 'Cobros',
        items: [
          admin && e('Métodos de pago', 'i-lucide-credit-card', 'metodos-pago', 'Con qué pueden pagar tus clientes: efectivo, tarjeta, transferencia.'),
          lee('Pasarelas') && e('Pasarelas de pago', 'i-lucide-plug-zap', 'pasarelas', 'La conexión con el cobro en línea.'),
        ],
      },
      {
        label: 'Caja',
        items: [
          lee('Cajas') && e('Cajas', 'i-lucide-inbox', 'cajas', 'Las cajas de tu local.'),
          admin && e('Motivos de diferencia', 'i-lucide-scale', 'motivos-diferencia', 'Las causas que se pueden elegir cuando una caja no cuadra.'),
        ],
      },
      {
        label: 'Inventario',
        items: [
          admin && e('Ubicaciones', 'i-lucide-warehouse', 'ubicaciones', 'Bodegas y locales donde guardas tu stock.'),
          admin && e('Motivos de baja', 'i-lucide-tags', 'motivos-baja', 'Las razones para dar de baja un producto: merma, vencimiento, rotura.'),
          admin && e('Motivos de diferencia (inventario)', 'i-lucide-clipboard-check', 'motivos-diferencia-inventario', 'Las causas que se pueden elegir cuando un conteo no coincide.'),
          admin && e('Motivos de traslado', 'i-lucide-truck', 'motivos-traslado', 'Las razones para mover stock entre ubicaciones.'),
        ],
      },
      {
        label: 'Restaurante',
        items: [
          lee('Salones') && e('Salones y mesas', 'i-lucide-utensils', 'salones', 'El plano de tu salón y sus mesas.'),
          lee('Salones') && e('Garzones', 'i-lucide-users', 'garzones', 'Quién atiende las mesas y con qué PIN.'),
          lee('Salones') && e('Turnos', 'i-lucide-clock-3', 'turnos', 'Los turnos de trabajo de tu local.'),
          (lee('Propinas') || permissionsStore.can('Propinas', 'Configurar'))
          && e('Distribución de propinas', 'i-lucide-hand-coins', 'propinas-distribucion', 'Cómo se reparte la propina entre tu equipo.'),
          lee('Impresoras') && e('Impresoras', 'i-lucide-printer', 'impresoras', 'Dónde sale la comanda y el ticket.'),
        ],
      },
      {
        label: 'Paquetería',
        items: [
          // Admin-only en el backend y, además, de un módulo que el tenant contrata: hace falta ser
          // admin Y tenerlo en `mis-permisos`. `lee()` solo pide lo segundo, y en `mis-permisos`
          // `Paquetería:Leer` también puede tenerlo un rol que no es admin.
          admin && permissionsStore.can('Paquetería', 'Leer')
          && e('Repartidores', 'i-lucide-bike', 'repartidores', 'Quién reparte tus paquetes.'),
          admin && permissionsStore.can('Paquetería', 'Leer')
          && e('Valores por defecto', 'i-lucide-badge-dollar-sign', 'paqueteria', 'Los montos que se proponen al recibir un paquete.'),
        ],
      },
    ]

    return grupos
      .map(g => ({ label: g.label, items: g.items.filter((i): i is EntradaConfiguracion => i !== false) }))
      .filter(g => g.items.length > 0)
  })
}
