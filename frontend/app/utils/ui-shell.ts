/** Padding y espaciado estándar de shells (card, modal). Ver DESIGN-SYSTEM.md § Espaciado. */
export const shellUi = {
  card: {
    header: 'px-6 pt-4 pb-5 sm:px-6 sm:pt-4 sm:pb-5',
    body: 'px-6 py-4 sm:px-6 sm:py-4',
    footer: 'px-6 py-4 sm:px-6 sm:py-4',
    title: 'text-base font-semibold text-default',
    description: 'text-sm text-muted !mt-2',
  },
  modal: {
    content: 'bg-default flex flex-col focus:outline-none text-default divide-none',
    header: 'relative flex flex-col items-start gap-2 px-6 pt-4 pb-4 sm:px-6 sm:pt-4 sm:pb-4 min-h-(--ui-header-height)',
    body: 'flex-1 px-6 py-4 space-y-4 sm:px-6 sm:py-4',
    footer: 'px-6 pt-0 pb-4 sm:px-6 sm:pb-4',
    title: 'text-base font-semibold text-default',
    description: 'text-sm text-muted !mt-2',
  },
} as const

/** Separador insetado dentro de un shell que ya tiene px-6. */
export const shellInsetDividerClass = 'border-t border-default pt-4'
