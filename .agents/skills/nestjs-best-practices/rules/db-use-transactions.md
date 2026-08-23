---
title: Use Transactions for Multi-Step Operations
impact: HIGH
impactDescription: Ensures data consistency in multi-step operations
tags: database, transactions, typeorm, consistency
---

## Use Transactions for Multi-Step Operations

When multiple database operations must succeed or fail together, wrap them in a transaction. This prevents partial updates that leave your data in an inconsistent state. Use TypeORM's transaction APIs or the DataSource query runner for complex scenarios.

**Incorrect (multiple saves without transaction):**

```typescript
// Multiple saves without transaction
@Injectable()
export class OrdersService {
  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    // If any step fails, data is inconsistent
    const order = await this.orderRepo.save({ userId, status: 'pending' });

    for (const item of items) {
      await this.orderItemRepo.save({ orderId: order.id, ...item });
      await this.inventoryRepo.decrement({ productId: item.productId }, 'stock', item.quantity);
    }

    await this.paymentService.charge(order.id);
    // If payment fails, order and inventory are already modified!

    return order;
  }
}
```

**Correct in THIS repo — `db.transaccion`, y el manager viaja solo (ADR-020):**

⛔ **La receta genérica de TypeORM —`dataSource.transaction`, inyectar `DataSource`,
`createQueryRunner()`— está PROHIBIDA POR LINT en `src/**`** (`eslint.config.mjs`;
excepciones: la propia fachada `Db`, el seeder y `*.spec.ts`). No es estilo: reabre un
deadlock que este proyecto ya midió. Ver el override al tope de `SKILL.md`.

**El deadlock, en una línea:** un service que adentro de una transacción pide una conexión
**nueva** al pool necesita dos a la vez. Con el pool en 10, 9 operaciones concurrentes pasan
y la décima cuelga para siempre — no es timeout, el proceso queda envenenado hasta reiniciar.

```typescript
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: Db, // la fachada, NUNCA DataSource
    private readonly pagos: PagosService,
  ) {}

  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    return this.db.transaccion(async (manager) => {
      const order = await manager.save(
        manager.create(Order, { userId, status: 'pending' }),
      );

      for (const item of items) {
        await manager.save(manager.create(OrderItem, { orderId: order.id, ...item }));
      }

      // NO hace falta pasar `manager`: `cobrar` resuelve solo la transacción
      // activa, y si adentro abre `db.transaccion` la REUSA en vez de anidar.
      // Eso es lo que hace seguro envolver código viejo en una transacción nueva.
      await this.pagos.cobrar(order.id);

      return order;
    });
  }
}
```

**Precondición del módulo — sin esto nada de lo anterior aplica:**

```typescript
@Module({
  // `RepositoriosModule`, no `TypeOrmModule`: provee los repos como Proxy que
  // resuelven el manager del contexto. Con `TypeOrmModule.forFeature` los repos
  // quedan atados al pool y el deadlock vuelve, sin que se vea en ningún
  // constructor — el registro pasa por el decorador `@Module`.
  imports: [RepositoriosModule.forFeature([Order, OrderItem])],
  providers: [OrdersService],
})
export class OrdersModule {}
```

**Las otras dos puertas de la fachada:**

- `db.query(sql, params)` — usa el manager del contexto si hay transacción abierta, el pool
  si no. Reemplaza a `dataSource.query`.
- `db.sinTransaccion(fn)` — la salida **explícita** para lo que deliberadamente necesita su
  propia conexión estando dentro de una transacción: auditoría que debe sobrevivir a un
  rollback, housekeeping que no necesita ser atómico con lo demás.

**Lo que sigue valiendo de la regla genérica:** que varias escrituras que tienen que
cumplirse o fallar juntas van adentro de una transacción. Lo que cambia es **cómo se abre**.

📌 El porqué completo, con el experimento (9 ok / 10 cuelga) y las alternativas descartadas:
[ADR-020](../../../../docs/adr/020-contexto-transaccional-als.md) y
[`docs/patterns/backend.md`](../../../../docs/patterns/backend.md) §5.

Reference: [TypeORM Transactions](https://typeorm.io/transactions)
