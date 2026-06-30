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
      default: { light: 'border-gray-200', dark: 'dark:border-gray-700' },
    },
    bg: {
      default: { light: 'bg-white', dark: 'dark:bg-gray-900' },
      elevated: { light: 'bg-gray-50', dark: 'dark:bg-gray-800' },
      muted: { light: 'bg-gray-100', dark: 'dark:bg-gray-800' },
    },
    divider: { light: 'divide-gray-100', dark: 'dark:divide-gray-800' },
  },
})
