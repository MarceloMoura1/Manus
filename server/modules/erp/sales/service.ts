import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWriteSales,
  normalizeSaleDraft,
  saleEvent,
  type SaleAddressCorrectionInput,
  type SaleConfirmationInput,
  type SaleDraftInput,
  type SaleListInput,
  type SaleOperation,
  type SaleTransitionInput,
} from "./contracts";
import { SaleRepository } from "./repository";

type Identity = {
  clientId: string;
  userId: string;
  userName: string | null;
  role: OperationalRole;
};

export type SaleEventPublisher = {
  publish(
    clientId: string,
    event: "erp:sale.changed" | "erp:stock.changed" | "erp:finance.entry.changed",
    payload: Record<string, string>
  ): void | Promise<void>;
};

const socketPublisher: SaleEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};

export class SaleService {
  constructor(
    private repository = new SaleRepository(),
    private events: SaleEventPublisher = socketPublisher
  ) {}

  private actor(identity: Identity) {
    return { userId: identity.userId, name: identity.userName };
  }

  private write(identity: Identity) {
    if (!canWriteSales(identity.role)) {
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil possui acesso somente leitura em Vendas."
      );
    }
  }

  private async publish(
    clientId: string,
    publicId: string,
    operation: SaleOperation,
    options: { stockIds?: string[]; finance?: boolean } = {}
  ) {
    const occurredAt = new Date().toISOString();
    await runPostCommitBestEffort([
      () =>
        this.events.publish(
          clientId,
          "erp:sale.changed",
          saleEvent(publicId, operation, occurredAt)
        ),
      ...(options.finance
        ? [
            () =>
              this.events.publish(clientId, "erp:finance.entry.changed", {
                publicId,
                operation: "sale_titles_changed",
                occurredAt,
              }),
          ]
        : []),
      ...(options.stockIds ?? []).map(
        productPublicId => () =>
          this.events.publish(clientId, "erp:stock.changed", {
            productPublicId,
            operation: "sale_shipped",
            occurredAt,
          })
      ),
    ]);
  }

  async metrics(identity: Identity, period: { from?: string; to?: string }) {
    return this.repository.metrics(identity.clientId, period.from, period.to);
  }

  async list(identity: Identity, input: SaleListInput) {
    const result = await this.repository.list(identity.clientId, input);
    return {
      ...result,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(result.total / input.pageSize),
      canWrite: canWriteSales(identity.role),
    };
  }

  async options(identity: Identity) {
    return {
      ...(await this.repository.options(identity.clientId)),
      canWrite: canWriteSales(identity.role),
    };
  }

  async customers(identity: Identity, input: { search: string; page: number; pageSize: number }) {
    return this.repository.customers(identity.clientId, input.search, input.page, input.pageSize);
  }

  async catalog(identity: Identity, input: { search: string; page: number; pageSize: number }) {
    return this.repository.catalog(identity.clientId, input.search, input.page, input.pageSize);
  }

  async detail(identity: Identity, id: string) {
    const result = await this.repository.detail(identity.clientId, id);
    if (!result) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
    return { ...result, canWrite: canWriteSales(identity.role) };
  }

  async create(identity: Identity, input: SaleDraftInput) {
    this.write(identity);
    const result = await this.repository.save(
      identity.clientId,
      this.actor(identity),
      normalizeSaleDraft(input)
    );
    if (!result) throw new Error("Venda não persistida.");
    await this.publish(identity.clientId, result.publicId, "created");
    return result;
  }

  async update(identity: Identity, id: string, input: SaleDraftInput) {
    this.write(identity);
    const result = await this.repository.save(
      identity.clientId,
      this.actor(identity),
      normalizeSaleDraft(input),
      id
    );
    if (!result) throw new ErpDomainError("NOT_FOUND", "Venda não encontrada.");
    await this.publish(identity.clientId, id, "updated");
    return result;
  }

  async confirm(identity: Identity, input: SaleConfirmationInput) {
    this.write(identity);
    const result = await this.repository.confirm(identity.clientId, this.actor(identity), input);
    if (!result.order) throw new Error("Confirmação da venda não persistida.");
    if (!result.replay) {
      await this.publish(identity.clientId, input.publicId, "confirmed", { finance: true });
    }
    return { ...result.order, replay: result.replay };
  }

  async transition(identity: Identity, input: SaleTransitionInput) {
    this.write(identity);
    const result = await this.repository.transition(identity.clientId, this.actor(identity), input);
    if (!result.order) throw new Error("Etapa da venda não persistida.");
    if (!result.replay) {
      await this.publish(
        identity.clientId,
        input.publicId,
        result.stockChanged ? "shipped" : "stage_changed",
        {
          stockIds: result.stockChanged
            ? result.order.items.map(item => item.productPublicId)
            : [],
        }
      );
    }
    return { ...result.order, replay: result.replay };
  }

  async cancel(identity: Identity, id: string, reason: string) {
    this.write(identity);
    const result = await this.repository.cancel(
      identity.clientId,
      this.actor(identity),
      id,
      reason
    );
    if (!result) throw new Error("Cancelamento da venda não persistido.");
    await this.publish(identity.clientId, id, "cancelled", { finance: true });
    return result;
  }

  async correctAddress(identity: Identity, input: SaleAddressCorrectionInput) {
    this.write(identity);
    const result = await this.repository.correctAddress(
      identity.clientId,
      this.actor(identity),
      input
    );
    if (!result) throw new Error("Correção de endereço não persistida.");
    await this.publish(identity.clientId, input.publicId, "address_corrected");
    return result;
  }

  async fulfill(identity: Identity, id: string, key: string) {
    return this.transition(identity, {
      publicId: id,
      toStage: "shipped",
      idempotencyKey: key,
      reason: null,
    });
  }
}
