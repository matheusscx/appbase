import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// Invariante: el `ValidationPipe` de la API se construye en UN solo lugar
// (`src/common/pipes/validacion-global.pipe.ts`), y tanto `main.ts` como cada
// spec e2e lo toman de ahí. El e2e no ejecuta `main.ts`: arma su propia app, y
// hasta el 2026-09-27 cada spec copiaba el pipe a mano (112 copias en 88
// specs). Con eso, cambiar la configuración en `main.ts` —prender
// `forbidNonWhitelisted`, por ejemplo— dejaba al e2e probando el pipe viejo, y
// la suite en verde decía algo de una API que ya no existía.

const BACKEND = join(__dirname, '..', '..', '..');
const UNICO = join('src', 'common', 'pipes', 'validacion-global.pipe.ts');

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Los comentarios del repo nombran el pipe seguido (`ValidationPipe({ whitelist:
// true, ... })` para explicar una conducta); lo que cuenta es el código.
function sinComentarios(contenido: string): string {
  return contenido.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const archivos = [
  ...findTsFiles(join(BACKEND, 'src')),
  ...findTsFiles(join(BACKEND, 'test')),
].map((full) => ({
  ruta: relative(BACKEND, full),
  codigo: sinComentarios(readFileSync(full, 'utf8')),
}));

describe('Invariante: un solo ValidationPipe, compartido por main.ts y el e2e', () => {
  it('nadie fuera de validacion-global.pipe.ts construye un ValidationPipe', () => {
    const violaciones = archivos
      .filter(({ ruta }) => ruta !== UNICO)
      .filter(({ codigo }) => /\bnew\s+ValidationPipe\s*\(/.test(codigo))
      .map(({ ruta }) => ruta);
    expect(violaciones).toEqual([]);
  });

  it('main.ts instala el pipe compartido', () => {
    const main = archivos.find(({ ruta }) => ruta === join('src', 'main.ts'));
    expect(main?.codigo).toMatch(
      /useGlobalPipes\(\s*validacionGlobal\(\)\s*\)/,
    );
  });

  // Sin esto un spec podría instalar otro pipe cualquiera (o una subclase) y
  // el barrido de arriba no lo vería.
  it('todo spec e2e que instala pipes globales instala el compartido', () => {
    const contar = (texto: string, patron: string) =>
      texto.split(patron).length - 1;
    const violaciones = archivos
      .filter(({ ruta }) => ruta.startsWith('test'))
      .filter(({ codigo }) => {
        const compacto = codigo.replace(/\s+/g, '').replace(/,\)/g, ')');
        return (
          contar(compacto, 'useGlobalPipes(') !==
          contar(compacto, 'useGlobalPipes(validacionGlobal())')
        );
      })
      .map(({ ruta }) => ruta);
    expect(violaciones).toEqual([]);
  });
});
