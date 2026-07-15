import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CredencialesService } from './credenciales.service';
import { Pasarela } from '../entities/pasarela.entity';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';
import { CreateTenantPasarelaDto } from '../dto/create-tenant-pasarela.dto';
import { UpdateTenantPasarelaDto } from '../dto/update-tenant-pasarela.dto';

@Injectable()
export class TenantPasarelaService {
  constructor(
    @InjectRepository(TenantPasarela)
    private readonly tpRepo: Repository<TenantPasarela>,
    @InjectRepository(Pasarela)
    private readonly pasarelaRepo: Repository<Pasarela>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credenciales: CredencialesService,
  ) {}

  async listar(tenantId: string) {
    const rows: {
      tenant_pasarela_id: string;
      pasarela_id: string;
      codigo: string;
      nombre: string;
      ambiente: string;
      modo_integracion: string;
      activo: boolean;
      prioridad: number;
      tiene_credenciales: boolean;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT tp.tenant_pasarela_id, tp.pasarela_id, p.codigo, p.nombre,
              tp.ambiente, tp.modo_integracion, tp.activo, tp.prioridad,
              (tp.configuracion IS NOT NULL) AS tiene_credenciales, tp.creado_el
       FROM tenant_pasarela tp
       JOIN pasarelas p ON p.pasarela_id = tp.pasarela_id AND p.eliminado_el IS NULL
       WHERE tp.tenant_id = $1 AND tp.eliminado_el IS NULL
       ORDER BY tp.prioridad ASC, tp.creado_el ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      tenantPasarelaId: r.tenant_pasarela_id,
      pasarelaId: r.pasarela_id,
      codigo: r.codigo,
      nombre: r.nombre,
      ambiente: r.ambiente,
      modoIntegracion: r.modo_integracion,
      activo: r.activo,
      prioridad: r.prioridad,
      tieneCredenciales: r.tiene_credenciales,
      creadoEl: r.creado_el,
    }));
  }

  /** Catálogo global para el selector del drawer (sin configuración). */
  listarPasarelasGlobales() {
    return this.pasarelaRepo.find({
      where: { activo: true },
      select: {
        pasarelaId: true,
        codigo: true,
        nombre: true,
        soportaTokenizacion: true,
        soportaCobroRecurrente: true,
        soportaMall: true,
      },
      order: { nombre: 'ASC' },
    });
  }

  async crear(tenantId: string, dto: CreateTenantPasarelaDto) {
    const pasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: dto.pasarelaId, activo: true },
    });
    if (!pasarela) throw new BadRequestException('Pasarela no disponible');
    if (dto.modoIntegracion === 'mall' && !pasarela.soportaMall)
      throw new BadRequestException('Esta pasarela no soporta modo mall');

    const guardada = await this.tpRepo.save(
      this.tpRepo.create({
        tenantId,
        pasarelaId: dto.pasarelaId,
        ambiente: dto.ambiente,
        modoIntegracion: dto.modoIntegracion,
        configuracion: dto.configuracion
          ? this.credenciales.cifrarJson(dto.configuracion)
          : null,
        activo: dto.activo ?? true,
        prioridad: dto.prioridad ?? 1,
      }),
    );
    return {
      tenantPasarelaId: guardada.tenantPasarelaId,
      pasarelaId: pasarela.pasarelaId,
      codigo: pasarela.codigo,
      nombre: pasarela.nombre,
      ambiente: guardada.ambiente,
      modoIntegracion: guardada.modoIntegracion,
      activo: guardada.activo,
      prioridad: guardada.prioridad,
      tieneCredenciales: !!guardada.configuracion,
      creadoEl: guardada.creadoEl,
    };
  }

  async actualizar(
    tenantId: string,
    tenantPasarelaId: string,
    dto: UpdateTenantPasarelaDto,
  ) {
    const tp = await this.tpRepo.findOne({
      where: { tenantPasarelaId, tenantId },
    });
    if (!tp)
      throw new NotFoundException('Configuración de pasarela no encontrada');
    if (dto.ambiente !== undefined) tp.ambiente = dto.ambiente;
    if (dto.modoIntegracion !== undefined)
      tp.modoIntegracion = dto.modoIntegracion;
    if (dto.activo !== undefined) tp.activo = dto.activo;
    if (dto.prioridad !== undefined) tp.prioridad = dto.prioridad;
    // Write-only: solo re-cifrar si mandaron credenciales nuevas.
    // null explícito = limpiar credenciales (nunca cifrar "null").
    if (dto.configuracion === null) {
      tp.configuracion = null;
    } else if (dto.configuracion !== undefined) {
      tp.configuracion = this.credenciales.cifrarJson(dto.configuracion);
    }
    await this.tpRepo.save(tp);
    return {
      tenantPasarelaId,
      ambiente: tp.ambiente,
      modoIntegracion: tp.modoIntegracion,
      activo: tp.activo,
      prioridad: tp.prioridad,
      tieneCredenciales: !!tp.configuracion,
    };
  }

  async eliminar(tenantId: string, tenantPasarelaId: string) {
    const tp = await this.tpRepo.findOne({
      where: { tenantPasarelaId, tenantId },
    });
    if (!tp)
      throw new NotFoundException('Configuración de pasarela no encontrada');
    await this.tpRepo.softRemove(tp);
    return { tenantPasarelaId };
  }

  /** Config activa del tenant para una pasarela por código + credenciales resueltas. */
  async resolverConfiguracionActiva(tenantId: string, codigoPasarela: string) {
    const rows: { tenant_pasarela_id: string }[] = await this.dataSource.query(
      `SELECT tp.tenant_pasarela_id
       FROM tenant_pasarela tp
       JOIN pasarelas p ON p.pasarela_id = tp.pasarela_id
            AND p.codigo = $2 AND p.activo = true AND p.eliminado_el IS NULL
       WHERE tp.tenant_id = $1 AND tp.activo = true AND tp.eliminado_el IS NULL
       ORDER BY tp.prioridad ASC LIMIT 1`,
      [tenantId, codigoPasarela],
    );
    const tenantPasarela = rows[0]
      ? await this.tpRepo.findOne({
          where: { tenantPasarelaId: rows[0].tenant_pasarela_id },
        })
      : null;
    if (!tenantPasarela)
      throw new BadRequestException(
        `El tenant no tiene configurada la pasarela ${codigoPasarela}`,
      );
    const pasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: tenantPasarela.pasarelaId },
    });
    if (!pasarela) throw new NotFoundException('Pasarela no encontrada');
    const cred = this.credenciales.resolver(tenantPasarela, pasarela);
    return { tenantPasarela, pasarela, cred };
  }

  /**
   * Resuelve la config + credenciales de una configuración concreta por su id
   * (no por la activa del tenant): para reembolsar/reconciliar una orden bajo
   * la MISMA pasarela con que se cobró, aunque el tenant haya cambiado de activa.
   * Incluye configuraciones soft-deleted: una orden vieja sigue siendo operable.
   */
  async resolverPorId(tenantPasarelaId: string) {
    const tenantPasarela = await this.tpRepo.findOne({
      where: { tenantPasarelaId },
      withDeleted: true,
    });
    if (!tenantPasarela)
      throw new NotFoundException('Configuración de pasarela no encontrada');
    const pasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: tenantPasarela.pasarelaId },
      withDeleted: true,
    });
    if (!pasarela) throw new NotFoundException('Pasarela no encontrada');
    const cred = this.credenciales.resolver(tenantPasarela, pasarela);
    return { tenantPasarela, pasarela, cred };
  }
}
