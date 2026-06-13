---
name: new-module
description: Scaffold a new NestJS feature module with controller, service, entity, and DTOs, then register it in app.module.ts
disable-model-invocation: true
---

Generate a complete NestJS feature module at `backend/src/modules/$ARGUMENTS/` following the project conventions in CLAUDE.md.

Create these files:
- `$ARGUMENTS.module.ts` — NestJS module that imports TypeOrmModule.forFeature([Entity]) and declares controller + service
- `$ARGUMENTS.controller.ts` — REST controller with CRUD routes, use @ApiTags for Swagger
- `$ARGUMENTS.service.ts` — Injectable service with constructor-injected repository
- `$ARGUMENTS.entity.ts` — TypeORM entity with @Entity, @PrimaryGeneratedColumn, @Column decorators
- `dto/create-$ARGUMENTS.dto.ts` — DTO with class-validator decorators
- `dto/update-$ARGUMENTS.dto.ts` — PartialType of create DTO

Then register the new module in `backend/src/app.module.ts` imports array.

Use singular PascalCase for class names (e.g., argument "users" → class "User").
