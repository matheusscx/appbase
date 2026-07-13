// qz-tray 2.x no publica tipos propios. Shim mínimo con la superficie que usa
// useImpresoras (websocket + configs + print). Ver docs/features/impresion-termica.md.
declare module 'qz-tray' {
  interface QzWebsocket {
    isActive(): boolean
    connect(options?: Record<string, unknown>): Promise<void>
    disconnect(): Promise<void>
  }

  interface QzConfigs {
    create(
      printer: string | { host: string, port: number },
      options?: Record<string, unknown>,
    ): unknown
  }

  interface Qz {
    websocket: QzWebsocket
    configs: QzConfigs
    print(config: unknown, data: unknown[]): Promise<void>
  }

  const qz: Qz
  export default qz
}
