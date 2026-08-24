import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWriteSales,
  normalizeSaleDraft,
  saleEvent,
  type SaleDraftInput,
  type SaleListInput,
  type SaleOperation,
} from "./contracts";
import { SaleRepository } from "./repository";
type Identity = { clientId: string; userId: string; role: OperationalRole };
export type SaleEventPublisher = {
  publish(
    clientId: string,
    event: "erp:sale.changed" | "erp:stock.changed",
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
  private write(i: Identity) {
    if (!canWriteSales(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil nÃ£o permite alterar vendas."
      );
  }
  private async publish(
    clientId: string,
    publicId: string,
    operation: SaleOperation,
    stockIds: string[] = []
  ) {
    const occurredAt = new Date().toISOString();
    await runPostCommitBestEffort([
      () =>
        this.events.publish(
          clientId,
          "erp:sale.changed",
          saleEvent(publicId, operation, occurredAt)
        ),
      ...stockIds.map(
        productPublicId => () =>
          this.events.publish(clientId, "erp:stock.changed", {
            productPublicId,
            operation: "sale_fulfilled",
            occurredAt,
          })
      ),
    ]);
  }
  async list(i: Identity, input: SaleListInput) {
    const r = await this.repository.list(i.clientId, input);
    return {
      ...r,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(r.total / input.pageSize),
      canWrite: canWriteSales(i.role),
    };
  }
  async options(i: Identity) {
    this.write(i);
    return this.repository.options(i.clientId);
  }
  async detail(i: Identity, id: string) {
    const r = await this.repository.detail(i.clientId, id);
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
    return { ...r, canWrite: canWriteSales(i.role) };
  }
  async create(i: Identity, input: SaleDraftInput) {
    this.write(i);
    const r = await this.repository.save(
      i.clientId,
      i.userId,
      normalizeSaleDraft(input)
    );
    if (!r) throw new Error("Pedido nÃ£o persistido.");
    await this.publish(i.clientId, r.publicId, "created");
    return r;
  }
  async update(i: Identity, id: string, input: SaleDraftInput) {
    this.write(i);
    const r = await this.repository.save(
      i.clientId,
      i.userId,
      normalizeSaleDraft(input),
      id
    );
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido nÃ£o encontrado.");
    await this.publish(i.clientId, id, "updated");
    return r;
  }
  async confirm(i: Identity, id: string) {
    this.write(i);
    const r = await this.repository.transition(
      i.clientId,
      i.userId,
      id,
      "confirmed"
    );
    await this.publish(i.clientId, id, "confirmed");
    return r;
  }
  async cancel(i: Identity, id: string, reason: string) {
    this.write(i);
    const r = await this.repository.transition(
      i.clientId,
      i.userId,
      id,
      "cancelled",
      reason
    );
    await this.publish(i.clientId, id, "cancelled");
    return r;
  }
  async fulfill(i: Identity, id: string, key: string) {
    this.write(i);
    const r = await this.repository.fulfill(i.clientId, i.userId, id, key);
    if (!r.order) throw new Error("Recebimento nÃ£o persistido.");
    if (!r.replay)
      await this.publish(
        i.clientId,
        id,
        "fulfilled",
        r.order.items.map(x => x.productPublicId)
      );
    return { ...r.order, replay: r.replay };
  }
}
