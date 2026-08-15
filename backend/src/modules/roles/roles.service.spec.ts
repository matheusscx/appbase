import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { Rol } from './entities/rol.entity';
import { RolUsuario } from './entities/rol-usuario.entity';
import { ModuloRol } from './entities/modulo-rol.entity';
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';

const ROL = 'rol-uuid';
const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';

describe('RolesService', () => {
  let service: RolesService;
  let rolRepo: { findOne: jest.Mock };
  let rolUsuarioRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    rolRepo = {
      findOne: jest.fn().mockResolvedValue({ id: ROL, tenantId: TENANT }),
    };
    rolUsuarioRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: unknown) => data),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
    };
    // Por defecto el usuario SÍ es miembro del tenant.
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Rol), useValue: rolRepo },
        { provide: getRepositoryToken(RolUsuario), useValue: rolUsuarioRepo },
        { provide: getRepositoryToken(ModuloRol), useValue: {} },
        { provide: getRepositoryToken(RolPermisoModulo), useValue: {} },
        { provide: getRepositoryToken(TenantModulo), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  describe('assignUser', () => {
    it('asigna cuando el rol y el usuario son del tenant', async () => {
      await expect(service.assignUser(ROL, TENANT, USUARIO)).resolves.toEqual({
        rolId: ROL,
        tenantId: TENANT,
        usuarioId: USUARIO,
      });
    });

    // El agujero que cerró esta entrada: se validaba al usuario pero nunca al
    // rol, así que un admin podía escribir en `roles_usuarios` una fila que
    // apunta a un rol de otro tenant.
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignUser('rol-de-otro-tenant', TENANT, USUARIO),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rolUsuarioRepo.save).not.toHaveBeenCalled();
    });

    it('busca el rol acotado por id Y tenant, no solo por id', async () => {
      await service.assignUser(ROL, TENANT, USUARIO);

      expect(rolRepo.findOne).toHaveBeenCalledWith({
        where: { id: ROL, tenantId: TENANT },
      });
    });

    it('valida el rol antes de tocar la membresía del usuario', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignUser(ROL, TENANT, USUARIO),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Si el rol no existe, ni siquiera se consulta si el usuario es miembro.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('sigue rechazando a un usuario ajeno al tenant', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.assignUser(ROL, TENANT, USUARIO),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rolUsuarioRepo.save).not.toHaveBeenCalled();
    });

    it('revive una asignación soft-borrada en vez de duplicarla', async () => {
      rolUsuarioRepo.findOne.mockResolvedValue({
        rolId: ROL,
        tenantId: TENANT,
        usuarioId: USUARIO,
        eliminadoEl: new Date(),
      });

      const res = (await service.assignUser(ROL, TENANT, USUARIO)) as {
        eliminadoEl: Date | null;
      };

      expect(res.eliminadoEl).toBeNull();
      expect(rolUsuarioRepo.create).not.toHaveBeenCalled();
    });
  });
});
