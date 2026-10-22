import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import type {
  ServiceInput,
  ServiceItem,
  ServiceListInput,
  ServiceListResult,
  ServiceResolvedForSale,
  ServiceUpdateInput,
} from "./contracts";
import { ServiceRepository } from "./repository";

export type ServiceIdentity = {
  clientId: string;
  userId: string;
  role: OperationalRole;
};

export function canWriteServices(role: OperationalRole): boolean {
  return role === "admin" || role === "manager";
}

export class ServiceService {
  constructor(private readonly repository: ServiceRepository = new ServiceRepository()) {}

  private assertWritePermission(role: OperationalRole) {
    if (!canWriteServices(role)) {
      throw new ErpDomainError("FORBIDDEN", "Usuário sem permissão para gerenciar serviços.");
    }
  }

  private notify(clientId: string, serviceId: number, operation: string) {
    runPostCommitBestEffort([
      () =>
        emitOperationalTenantEvent(clientId, "erp:service.changed" as any, {
          serviceId,
          operation,
          occurredAt: new Date().toISOString(),
        }),
    ]);
  }

  async list(identity: ServiceIdentity, options: ServiceListInput): Promise<ServiceListResult> {
    return this.repository.list(identity.clientId, options);
  }

  async getById(identity: ServiceIdentity, id: number): Promise<ServiceItem> {
    const service = await this.repository.getById(identity.clientId, id);
    if (!service) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    return service;
  }

  async create(identity: ServiceIdentity, input: ServiceInput): Promise<ServiceItem> {
    this.assertWritePermission(identity.role);
    const created = await this.repository.create(identity.clientId, input);
    this.notify(identity.clientId, created.id, "created");
    return created;
  }

  async update(
    identity: ServiceIdentity,
    id: number,
    input: Omit<ServiceUpdateInput, "id">
  ): Promise<ServiceItem> {
    this.assertWritePermission(identity.role);
    const existing = await this.repository.getById(identity.clientId, id);
    if (!existing) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    const updated = await this.repository.update(identity.clientId, id, input);
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    this.notify(identity.clientId, id, "updated");
    return updated;
  }

  async toggleActive(identity: ServiceIdentity, id: number): Promise<ServiceItem> {
    this.assertWritePermission(identity.role);
    const existing = await this.repository.getById(identity.clientId, id);
    if (!existing) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    const updated = await this.repository.toggleActive(identity.clientId, id);
    if (!updated) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    this.notify(identity.clientId, id, updated.isActive ? "activated" : "deactivated");
    return updated;
  }

  async delete(identity: ServiceIdentity, id: number): Promise<{ success: boolean }> {
    this.assertWritePermission(identity.role);
    const existing = await this.repository.getById(identity.clientId, id);
    if (!existing) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    const deleted = await this.repository.delete(identity.clientId, id);
    if (!deleted) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    this.notify(identity.clientId, id, "deleted");
    return { success: true };
  }

  async listCategories(identity: ServiceIdentity): Promise<string[]> {
    return this.repository.listCategories(identity.clientId);
  }

  async resolveForSale(identity: ServiceIdentity, serviceId: number): Promise<ServiceResolvedForSale> {
    const resolved = await this.repository.resolveForSale(identity.clientId, identity.userId, serviceId);
    if (!resolved) {
      throw new ErpDomainError("NOT_FOUND", "Serviço não encontrado.");
    }
    return resolved;
  }
}
