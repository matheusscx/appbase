export default defineAppConfig({
  ui: {
    colors: {
      primary: 'primary',
    },
    // Semantic color aliases
    text: {
      default: { light: 'text-gray-900', dark: 'dark:text-white' },
      muted: { light: 'text-gray-500', dark: 'dark:text-gray-400' },
      highlighted: { light: 'text-primary-600', dark: 'dark:text-primary-400' },
    },
    border: {
      default: { light: 'border-gray-200', dark: 'dark:border-gray-800' },
    },
    bg: {
      default: { light: 'bg-white', dark: 'dark:bg-gray-950' },
      elevated: { light: 'bg-gray-50', dark: 'dark:bg-gray-900' },
      muted: { light: 'bg-gray-100', dark: 'dark:bg-gray-900/80' },
    },
    divider: { light: 'divide-gray-100', dark: 'dark:divide-gray-900' },
    // Component-specific overrides
    card: {
      slots: {
        root: 'rounded-lg overflow-hidden bg-default ring ring-default divide-y divide-default',
        header: 'px-6 py-4',
        title: 'text-base font-semibold text-default',
        description: 'text-sm text-muted',
        body: 'px-6 py-4',
        footer: 'px-6 py-4',
      },
    },
    modal: {
      slots: {
        content: 'bg-default flex flex-col focus:outline-none text-default divide-none',
        header: 'relative flex flex-col items-start gap-1 px-6 py-4 min-h-(--ui-header-height)',
        body: 'flex-1 px-6 py-4 space-y-4',
        footer: 'px-6 py-4',
        title: 'text-base font-semibold text-default',
        description: 'text-sm text-muted',
        close: 'absolute top-4 end-4',
      },
    },
    formField: {
      label: { base: 'font-medium text-default' },
      description: { base: 'text-sm text-muted' },
    },
  },
})
