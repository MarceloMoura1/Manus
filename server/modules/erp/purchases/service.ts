import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  canWritePurchases,
  normalizePurchaseDraft,
  purchaseEvent,
  type PurchaseDraftInput,
  type PurchaseListInput,
  type PurchaseOperation,
} from "./contracts";
import { PurchaseRepository } from "./repository";
type Identity = { clientId: string; userId: string; role: OperationalRole };
export type PurchaseEventPublisher = {
  publish(
    clientId: string,
    event: "erp:purchase.changed" | "erp:stock.changed",
    payload: Record<string, string>
  ): void | Promise<void>;
};
const socketPublisher: PurchaseEventPublisher = {
  publish: (clientId, event, payload) =>
    emitOperationalTenantEvent(clientId, event, payload),
};
export class PurchaseService {
  constructor(
    private repository = new PurchaseRepository(),
    private events: PurchaseEventPublisher = socketPublisher
  ) {}
  private write(i: Identity) {
    if (!canWritePurchases(i.role))
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite alterar compras."
      );
  }
  private async publish(
    clientId: string,
    publicId: string,
    operation: PurchaseOperation,
    stockIds: string[] = []
  ) {
    const occurredAt = new Date().toISOString();
    await runPostCommitBestEffort([
      () =>
        this.events.publish(
          clientId,
          "erp:purchase.changed",
          purchaseEvent(publicId, operation, occurredAt)
        ),
      ...stockIds.map(
        productPublicId => () =>
          this.events.publish(clientId, "erp:stock.changed", {
            productPublicId,
            operation: "purchase_received",
            occurredAt,
          })
      ),
    ]);
  }
  async list(i: Identity, input: PurchaseListInput) {
    const r = await this.repository.list(i.clientId, input);
    return {
      ...r,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(r.total / input.pageSize),
      canWrite: canWritePurchases(i.role),
    };
  }
  async detail(i: Identity, id: string) {
    const r = await this.repository.detail(i.clientId, id);
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
    return { ...r, canWrite: canWritePurchases(i.role) };
  }
  async create(i: Identity, input: PurchaseDraftInput) {
    this.write(i);
    const r = await this.repository.save(
      i.clientId,
      i.userId,
      normalizePurchaseDraft(input)
    );
    if (!r) throw new Error("Pedido não persistido.");
    await this.publish(i.clientId, r.publicId, "created");
    return r;
  }
  async update(i: Identity, id: string, input: PurchaseDraftInput) {
    this.write(i);
    const r = await this.repository.save(
      i.clientId,
      i.userId,
      normalizePurchaseDraft(input),
      id
    );
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
    await this.publish(i.clientId, id, "updated");
    return r;
  }
  async approve(i: Identity, id: string) {
    this.write(i);
    const r = await this.repository.transition(
      i.clientId,
      i.userId,
      id,
      "approved"
    );
    await this.publish(i.clientId, id, "approved");
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
  async receive(i: Identity, id: string, key: string) {
    this.write(i);
    const r = await this.repository.receive(i.clientId, i.userId, id, key);
    if (!r.order) throw new Error("Recebimento não persistido.");
    if (!r.replay)
      await this.publish(
        i.clientId,
        id,
        "received",
        r.order.items.map(x => x.productPublicId)
      );
    return { ...r.order, replay: r.replay };
  }
}
