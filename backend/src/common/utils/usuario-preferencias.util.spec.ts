import {
  mergeUsuarioPreferencias,
  normalizeUsuarioPreferencias,
} from './usuario-preferencias.util';

describe('usuario-preferencias.util', () => {
  describe('normalizeUsuarioPreferencias', () => {
    it('aplica defaults cuando faltan claves', () => {
      expect(normalizeUsuarioPreferencias({})).toEqual({
        ui: { colorMode: 'system', pageSize: 15 },
      });
    });

    it('rechaza valores inválidos', () => {
      expect(
        normalizeUsuarioPreferencias({
          ui: { colorMode: 'neon' as never, pageSize: 99 as never },
        }),
      ).toEqual({
        ui: { colorMode: 'system', pageSize: 15 },
      });
    });
  });

  describe('mergeUsuarioPreferencias', () => {
    it('hace merge parcial en ui', () => {
      expect(
        mergeUsuarioPreferencias(
          { ui: { colorMode: 'dark', pageSize: 15 } },
          { ui: { pageSize: 25 } },
        ),
      ).toEqual({
        ui: { colorMode: 'dark', pageSize: 25 },
      });
    });
  });
});
