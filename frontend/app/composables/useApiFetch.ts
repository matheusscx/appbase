let refreshing: Promise<string> | null = null

export async function useApiFetch<T>(
  url: string,
  options: Parameters<typeof $fetch>[1] = {},
): Promise<T> {
  const store = useAuthStore()
  const config = useRuntimeConfig()

  const buildOptions = (): Parameters<typeof $fetch>[1] => ({
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
    },
  })

  try {
    return await $fetch<T>(url, buildOptions())
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status
    if (status !== 401) throw err

    try {
      if (!refreshing) {
        refreshing = $fetch<{ access_token: string }>(
          `${config.public.apiUrl}/auth/refresh`,
          { method: 'POST', credentials: 'include' },
        ).then((data) => {
          store.setToken(data.access_token)
          return data.access_token
        }).finally(() => {
          refreshing = null
        })
      }
      await refreshing
      return await $fetch<T>(url, buildOptions())
    } catch {
      store.clearAuth()
      navigateTo('/login')
      throw err
    }
  }
}
