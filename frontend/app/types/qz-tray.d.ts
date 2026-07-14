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

  interface QzSecurity {
    setCertificatePromise(handler: (resolve: (cert: string) => void, reject: (err: unknown) => void) => void): void
    setSignaturePromise(factory: (dataToSign: string) => (resolve: (sig: string) => void, reject: (err: unknown) => void) => void): void
    setSignatureAlgorithm(algorithm: 'SHA1' | 'SHA256' | 'SHA512'): void
  }

  interface Qz {
    websocket: QzWebsocket
    configs: QzConfigs
    security: QzSecurity
    print(config: unknown, data: unknown[]): Promise<void>
  }

  const qz: Qz
  export default qz
}
