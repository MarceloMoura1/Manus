import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEventForRoles } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canReadFiscal,
  canWriteFiscal,
  fiscalEvent,
  type FiscalListInput,
  type FiscalOperation,
  type FiscalSettingsInput,
  type ManualDocumentInput,
  type ProductFiscalProfileInput,
  type SourceDocumentInput,
  type UpdateDraftInput,
} from "./contracts";
import { FiscalRepository } from "./repository";
type Identity = { clientId: string; userId: string; role: OperationalRole };
export type FiscalEventPublisher = {
  publish(
    clientId: string,
    event: "erp:fiscal.document.changed" | "erp:fiscal.settings.changed",
    payload: Record<string, string>
  ): void | Promise<void>;
};
const publisher: FiscalEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEventForRoles(clientId, event, payload, [
      "admin",
      "manager",
      "viewer",
    ]),
};
export class FiscalService {
  constructor(
    private repository = new FiscalRepository(),
    private events: FiscalEventPublisher = publisher
  ) {}
  private read(i: Identity) {
    if (!canReadFiscal(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite acessar o Fiscal."
      );
  }
  private write(i: Identity) {
    this.read(i);
    if (!canWriteFiscal(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil possui acesso somente leitura ao Fiscal."
      );
  }
  private publish(
    clientId: string,
    event: "erp:fiscal.document.changed" | "erp:fiscal.settings.changed",
    publicId: string,
    operation: FiscalOperation
  ) {
    return runPostCommitBestEffort([
      () =>
        this.events.publish(clientId, event, fiscalEvent(publicId, operation)),
    ]);
  }
  async summary(i: Identity) {
    this.read(i);
    return {
      ...(await this.repository.summary(i.clientId)),
      canWrite: canWriteFiscal(i.role),
    };
  }
  async settings(i: Identity) {
    this.read(i);
    const value = await this.repository.settings(i.clientId);
    return value ? { ...value, canWrite: canWriteFiscal(i.role) } : null;
  }
  async saveSettings(i: Identity, input: FiscalSettingsInput) {
    this.write(i);
    const r = await this.repository.saveSettings(i.clientId, i.userId, input);
    await this.publish(
      i.clientId,
      "erp:fiscal.settings.changed",
      r.publicId,
      r.operation
    );
    return r;
  }
  async products(
    i: Identity,
    input: {
      search: string;
      incomplete?: boolean;
      page: number;
      pageSize: number;
    }
  ) {
    this.read(i);
    return {
      ...(await this.repository.products(i.clientId, input)),
      page: input.page,
      pageSize: input.pageSize,
      canWrite: canWriteFiscal(i.role),
    };
  }
  async saveProduct(i: Identity, input: ProductFiscalProfileInput) {
    this.write(i);
    return this.repository.saveProduct(i.clientId, i.userId, input);
  }
  async list(i: Identity, input: FiscalListInput) {
    this.read(i);
    const r = await this.repository.list(i.clientId, input);
    return {
      ...r,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(r.total / input.pageSize),
      canWrite: canWriteFiscal(i.role),
    };
  }
  async detail(i: Identity, id: string) {
    this.read(i);
    const r = await this.repository.detail(i.clientId, id);
    if (!r)
      throw new ErpDomainError(
        "NOT_FOUND",
        "Documento fiscal interno não encontrado."
      );
    return { ...r, canWrite: canWriteFiscal(i.role) };
  }
  async createSource(i: Identity, input: SourceDocumentInput) {
    this.write(i);
    const r = await this.repository.createSource(i.clientId, i.userId, input);
    if (!r.replay)
      await this.publish(
        i.clientId,
        "erp:fiscal.document.changed",
        r.document.publicId,
        "created"
      );
    return { ...r.document, replay: r.replay };
  }
  async createManual(i: Identity, input: ManualDocumentInput) {
    this.write(i);
    const r = await this.repository.createManual(i.clientId, i.userId, input);
    if (!r.replay)
      await this.publish(
        i.clientId,
        "erp:fiscal.document.changed",
        r.document.publicId,
        "created"
      );
    return { ...r.document, replay: r.replay };
  }
  async updateDraft(i: Identity, input: UpdateDraftInput) {
    this.write(i);
    const r = await this.repository.updateDraft(i.clientId, i.userId, input);
    await this.publish(
      i.clientId,
      "erp:fiscal.document.changed",
      input.publicId,
      "updated"
    );
    return r;
  }
  async ready(i: Identity, id: string, key: string) {
    this.write(i);
    const r = await this.repository.ready(i.clientId, i.userId, id, key);
    if (!r.replay)
      await this.publish(
        i.clientId,
        "erp:fiscal.document.changed",
        id,
        "ready_for_integration"
      );
    return { ...r.document, replay: r.replay };
  }
  async cancel(i: Identity, id: string, reason: string) {
    this.write(i);
    const r = await this.repository.cancel(i.clientId, i.userId, id, reason);
    await this.publish(
      i.clientId,
      "erp:fiscal.document.changed",
      id,
      "cancelled"
    );
    return r;
  }
}
