/**
 * El aviso de un cambio que se guardó al instante, con "Deshacer" (auditoría UX 07.12).
 *
 * `deshacer` es la reversa que escribe la pantalla (volver a llamar al mismo endpoint con el valor
 * anterior): este composable solo pone el toast. Lo que toca los cobros no pasa por acá, pide
 * confirmación antes con `CrudModal`.
 */
export function useAvisoDeshacer() {
  const toast = useToast()
  return function avisarConDeshacer(titulo: string, deshacer: () => void | Promise<void>) {
    toast.add({
      title: titulo,
      color: 'success',
      duration: 8000,
      actions: [{
        label: 'Deshacer',
        color: 'neutral',
        variant: 'outline',
        onClick: () => { void deshacer() },
      }],
    })
  }
}
