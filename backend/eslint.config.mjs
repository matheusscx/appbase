// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // El acceso directo al DataSource ignora el contexto transaccional (ALS) y
    // reabre el deadlock del pool (ADR-020). Toda query/transacción pasa por la
    // fachada Db. Excepciones: la propia fachada, y el seeder (corre al boot,
    // sin concurrencia).
    //
    // No alcanza con prohibir `dataSource.query/.transaction/.manager`: un
    // campo renombrado, un `getRepository`, una desestructuración o un alias
    // local lo esquivan en un refactor trivial. Por eso además se ataca el
    // chokepoint — inyectar `DataSource` — con dos selectores más: el
    // decorador `@InjectDataSource()` y el tipo `DataSource` en un parámetro
    // de constructor (Nest también resuelve por tipo, sin decorador). Sin
    // `DataSource` inyectado no hay campo que renombrar ni aliasear.
    files: ['src/**/*.ts'],
    ignores: [
      'src/common/db/**',
      'src/modules/seeder/**',
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.property.name="dataSource"][property.name=/^(query|transaction|manager|createQueryRunner)$/]',
          message:
            'dataSource directo ignora la transacción en contexto y reabre el deadlock del pool. Usar Db.query / Db.transaccion (src/common/db) — ver docs/patterns/backend.md.',
        },
        {
          selector: 'Decorator[expression.callee.name="InjectDataSource"]',
          message:
            'No inyectar DataSource directo. Inyectar Db (src/common/db) — es la única puerta al acceso a datos fuera de los repos.',
        },
        {
          selector:
            'MethodDefinition[kind="constructor"] TSParameterProperty > Identifier[typeAnnotation.typeAnnotation.typeName.name="DataSource"]',
          message:
            'No inyectar DataSource directo. Inyectar Db (src/common/db) — es la única puerta al acceso a datos fuera de los repos.',
        },
      ],
    },
  },
  {
    // Archivos de test: acceder a `any` de mocks y respuestas HTTP (res.body.x,
    // spies de jest) es uso legítimo, no deuda de tipos. Relajamos la familia
    // no-unsafe y unbound-method solo aquí; el código de producción sí las exige.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // mock async que espeja una firma async pero no usa await: patrón de jest.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
