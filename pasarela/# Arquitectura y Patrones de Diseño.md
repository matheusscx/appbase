# Arquitectura propuesta para NestJS

Se recomienda implementar la solución siguiendo una arquitectura inspirada en **Clean Architecture** utilizando las capacidades nativas de **NestJS**.

## Estructura sugerida

```text
src/

├── modules/
│   ├── payments/
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   ├── dto/
│   │   │   ├── interfaces/
│   │   │   ├── services/
│   │   │   └── use-cases/
│   │   │
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   ├── enums/
│   │   │   ├── repositories/
│   │   │   ├── value-objects/
│   │   │   └── events/
│   │   │
│   │   ├── infrastructure/
│   │   │   ├── gateways/
│   │   │   │   ├── oneclick/
│   │   │   │   ├── webpay/
│   │   │   │   ├── stripe/
│   │   │   │   └── mercadopago/
│   │   │   │
│   │   │   ├── persistence/
│   │   │   ├── http/
│   │   │   └── messaging/
│   │   │
│   │   ├── controllers/
│   │   └── payments.module.ts
│   │
│   └── webhooks/
│       ├── controllers/
│       ├── handlers/
│       └── webhooks.module.ts
│
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── exceptions/
│   └── logger/
│
└── main.ts
```

---

# Uso de Dependency Injection

Toda dependencia debe resolverse mediante el contenedor de NestJS.

Ejemplo:

```typescript
@Injectable()
export class CreatePaymentUseCase {

    constructor(
        private readonly gatewayFactory: GatewayFactory,
        private readonly orderRepository: OrderRepository,
        private readonly transactionRepository: TransactionRepository,
    ) {}

}
```

Nunca se deben instanciar clases utilizando `new`.

---

# Organización por Casos de Uso

Cada operación importante debe implementarse como un caso de uso independiente.

Ejemplo:

```text
CreatePaymentUseCase

ConfirmPaymentUseCase

RefundPaymentUseCase

ReversePaymentUseCase

CreateTokenUseCase

DeleteTokenUseCase
```

Los controladores únicamente reciben la petición HTTP y delegan la lógica al caso de uso correspondiente.

---

# Factory + Strategy

La selección de la pasarela debe centralizarse en una Factory.

```text
Controller

↓

UseCase

↓

GatewayFactory

↓

PaymentGateway

↓

OneclickGateway

StripeGateway

MercadoPagoGateway
```

Cada Gateway implementa la interfaz común `PaymentGateway`.

---

# Repositorios

Los repositorios pertenecen al dominio y su implementación a la infraestructura.

```typescript
export interface OrderRepository {

    save(order: Order): Promise<void>;

    findById(id: number): Promise<Order>;

}
```

La implementación puede utilizar TypeORM, Prisma o cualquier otra tecnología sin afectar el dominio.

---

# Eventos de Dominio

Después de una operación exitosa se recomienda publicar eventos.

Ejemplos:

```text
PaymentCreatedEvent

PaymentAuthorizedEvent

PaymentCapturedEvent

PaymentRefundedEvent
```

Estos eventos pueden ser procesados mediante `@nestjs/event-emitter` o enviados a RabbitMQ/Kafka en una evolución futura.

---

# Uso de Interceptors

Los Interceptors son ideales para:

- Registrar logs de entrada y salida.
- Medir tiempos de respuesta.
- Agregar Correlation ID.
- Estandarizar respuestas.
- Auditar llamadas a proveedores externos.

---

# Uso de Guards

Los Guards pueden validar:

- API Keys.
- Permisos.
- Acceso por cliente.
- Autenticación.

---

# Uso de Filters

Implementar un `GlobalExceptionFilter` para traducir excepciones internas a respuestas HTTP consistentes.

---

# Uso de DTOs

Todos los endpoints deben recibir DTOs validados mediante `class-validator`.

Ejemplo:

```typescript
export class CreatePaymentDto {

    @IsNumber()
    monto: number;

    @IsString()
    moneda: string;

}
```

---

# Configuración

Toda configuración debe obtenerse mediante `@nestjs/config`.

Las credenciales específicas de cada cliente continuarán almacenándose en la base de datos (`cliente_pasarelas`), mientras que la configuración global de la aplicación (puertos, Redis, RabbitMQ, logging, etc.) se gestionará mediante variables de entorno.

---

# Logging

Se recomienda utilizar el `Logger` de NestJS o integrar Pino/Winston.

Cada solicitud debe incluir un **Correlation ID** para facilitar la trazabilidad entre servicios.

---

# Testing

La arquitectura facilita las pruebas unitarias.

Los casos de uso dependen únicamente de interfaces, por lo que pueden utilizar repositorios y gateways simulados (mocks) sin necesidad de acceder a la base de datos ni invocar proveedores reales.


Además, haría un pequeño ajuste de nomenclatura

En lugar de llamar al módulo principal payments, lo llamaría gateway, porque tu proyecto no es simplemente "procesar pagos", sino administrar integraciones con proveedores.

Por ejemplo:

gateway/
├── application/
├── domain/
├── infrastructure/
├── controllers/
├── webhooks/
└── gateway.module.ts

Y dentro de infrastructure/gateways tendrías:

gateways/
├── oneclick/
├── webpay-plus/
├── stripe/
├── mercadopago/
└── adyen/

Esta estructura sigue las convenciones de NestJS y hace que incorporar una nueva pasarela normalmente implique agregar una carpeta con su implementación y registrarla en la GatewayFactory, sin modificar el resto del sistema.