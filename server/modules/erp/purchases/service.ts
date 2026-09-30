import { randomUUID } from "node:crypto";
import { runPostCommitBestEffort } from "../../../_core/post-commit";
import { emitOperationalTenantEvent } from "../../whatsapp/socket/whatsapp.socket";
import type { OperationalRole } from "../contracts";
import { ErpDomainError } from "../errors";
import {
  normalizePurchaseDraft,
  purchaseCapabilities,
  purchaseEvent,
  type PurchaseDraftInput,
  type PurchaseListInput,
  type PurchaseOperation,
  type PurchaseRequestDraftInput,
  type PurchaseRequestListInput,
  type QuoteProposalInput,
  type QuoteToOrderInput,
  type ReceiveInput,
  type RequestToOrderInput,
} from "./domain-contracts";
import { PurchaseRepository } from "./repository";
import { PurchaseWorkflowRepository, type PurchaseActor } from "./workflow-repository";
type Identity = { clientId: string; userId: string; role: OperationalRole; userName?: string };
type CompatibleRepository = PurchaseWorkflowRepository | PurchaseRepository;
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
const redactQuoteValues = <T,>(quote: T): T => quote ? ({
  ...(quote as any),
  proposals: (quote as any).proposals?.map((proposal: any) => ({
    ...proposal,
    subtotalCents: null,
    freightCents: null,
    totalCents: null,
    items: proposal.items?.map((item: any) => ({
      ...item,
      unitCostCents: null,
      discountCents: null,
      lineTotalCents: null,
    })),
  })),
} as T) : quote;
const redactRequestValues = <T,>(request: T): T => request ? ({
  ...(request as any),
  items: (request as any).items?.map((item: any) => ({ ...item, estimatedUnitCostCents: null })),
  quote: redactQuoteValues((request as any).quote),
  timeline: (request as any).timeline?.map(({ before: _before, after: _after, metadata: _metadata, ...event }: any) => event),
} as T) : request;
const redactOrderValues = <T,>(order: T): T => order ? ({
  ...(order as any),
  subtotalCents: null,
  discountCents: null,
  freightCents: null,
  otherExpensesCents: null,
  totalCents: null,
  financeTotalCents: null,
  paidCents: null,
  pendingCents: null,
  financialProgress: null,
  financialStatus: null,
  items: (order as any).items?.map((item: any) => ({
    ...item,
    unitCostCents: null,
    discountCents: null,
    lineTotalCents: null,
  })),
  payments: (order as any).payments?.map((payment: any) => ({
    ...payment,
    amountCents: null,
    paidCents: null,
    pendingCents: null,
  })),
  timeline: (order as any).timeline?.map(({ before: _before, after: _after, metadata: _metadata, ...event }: any) => event),
  history: [],
} as T) : order;
export class PurchaseService {
  constructor(
    private repository: CompatibleRepository = new PurchaseWorkflowRepository(),
    private events: PurchaseEventPublisher = socketPublisher
  ) {}
  private workflow() {
    return "listOrders" in this.repository
      ? (this.repository as PurchaseWorkflowRepository)
      : null;
  }
  private require(i: Identity, capability: keyof ReturnType<typeof purchaseCapabilities>) {
    if (!purchaseCapabilities(i.role)[capability])
      throw new ErpDomainError(
        "FORBIDDEN",
        "Seu perfil não permite alterar compras."
      );
  }
  private visibleOrder<T>(i: Identity, value: T): T {
    return purchaseCapabilities(i.role).canViewValues ? value : redactOrderValues(value);
  }
  private visibleRequest<T>(i: Identity, value: T): T {
    return purchaseCapabilities(i.role).canViewValues ? value : redactRequestValues(value);
  }
  private visibleQuote<T>(i: Identity, value: T): T {
    return purchaseCapabilities(i.role).canViewValues ? value : redactQuoteValues(value);
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
    const workflow = this.workflow();
    const r = workflow
      ? await workflow.listOrders(i.clientId, input)
      : await (this.repository as PurchaseRepository).list(
          i.clientId,
          input as Parameters<PurchaseRepository["list"]>[1]
        );
    return {
      ...r,
      items: r.items.map(item => this.visibleOrder(i, item)),
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(r.total / input.pageSize),
      canWrite: purchaseCapabilities(i.role).canEditOrder,
      capabilities: purchaseCapabilities(i.role),
    };
  }
  async detail(i: Identity, id: string) {
    const workflow = this.workflow();
    const r = workflow
      ? await workflow.orderDetail(i.clientId, id)
      : await (this.repository as PurchaseRepository).detail(i.clientId, id);
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
    return { ...this.visibleOrder(i, r), canWrite: purchaseCapabilities(i.role).canEditOrder, capabilities: purchaseCapabilities(i.role) };
  }
  async create(i: Identity, input: PurchaseDraftInput) {
    this.require(i, "canCreateOrder");
    const workflow = this.workflow();
    const result = workflow
      ? await workflow.createOrder(i as PurchaseActor, normalizePurchaseDraft(input))
      : { order: await (this.repository as PurchaseRepository).save(i.clientId, i.userId, normalizePurchaseDraft(input)), replay: false };
    const r = result.order;
    if (!r) throw new Error("Pedido não persistido.");
    if (!result.replay) await this.publish(i.clientId, r.publicId, "created");
    return { ...r, replay: result.replay };
  }
  async update(i: Identity, id: string, input: PurchaseDraftInput) {
    this.require(i, "canEditOrder");
    const workflow = this.workflow();
    const r = workflow
      ? await workflow.updateOrder(i as PurchaseActor, id, normalizePurchaseDraft(input))
      : await (this.repository as PurchaseRepository).save(i.clientId, i.userId, normalizePurchaseDraft(input), id);
    if (!r) throw new ErpDomainError("NOT_FOUND", "Pedido não encontrado.");
    await this.publish(i.clientId, id, "updated");
    return r;
  }
  async approve(i: Identity, id: string) {
    this.require(i, "canApprove");
    const workflow = this.workflow();
    const result = workflow
      ? await workflow.approveOrder(i as PurchaseActor, id, randomUUID())
      : { order: await (this.repository as PurchaseRepository).transition(i.clientId, i.userId, id, "approved"), replay: false };
    if (!result.replay) await this.publish(i.clientId, id, "approved");
    return result.order ? { ...result.order, replay: result.replay } : result.order;
  }
  async cancel(i: Identity, id: string, reason: string) {
    this.require(i, "canCancel");
    const workflow = this.workflow();
    const result = workflow
      ? await workflow.cancelOrder(i as PurchaseActor, id, reason)
      : { order: await (this.repository as PurchaseRepository).transition(i.clientId, i.userId, id, "cancelled", reason), replay: false };
    if (!result.replay) await this.publish(i.clientId, id, "cancelled");
    return result.order ? { ...result.order, replay: result.replay } : result.order;
  }
  async receive(i: Identity, idOrInput: string | ReceiveInput, key?: string) {
    this.require(i, "canReceive");
    const workflow = this.workflow();
    if (workflow) {
      let input: ReceiveInput;
      if (typeof idOrInput === "string") {
        const order = await workflow.orderDetail(i.clientId, idOrInput);
        if (!order) throw new ErpDomainError("NOT_FOUND", "Pedido nao encontrado.");
        input = {
          publicId: idOrInput,
          idempotencyKey: String(key),
          notes: null,
          documentNumber: null,
          items: order.items
            .filter(item => Number(item.pendingQuantity) > 0)
            .map(item => ({ orderItemPublicId: item.publicId, quantity: item.pendingQuantity })),
        };
      } else input = idOrInput;
      const result = await workflow.receiveOrder(i as PurchaseActor, input);
      if (!result.order) throw new Error("Recebimento nao persistido.");
      if (!result.replay) await this.publish(i.clientId, input.publicId, "received", result.stockProductPublicIds);
      return { ...this.visibleOrder(i, result.order), replay: result.replay };
    }
    const id = String(idOrInput);
    const r = await (this.repository as PurchaseRepository).receive(i.clientId, i.userId, id, String(key));
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

  capabilities(i: Identity) {
    return purchaseCapabilities(i.role);
  }

  async summary(i: Identity) {
    const workflow = this.workflow();
    const result = workflow
      ? await workflow.summary(i.clientId)
      : {
          pendingApprovals: 0,
          openOrders: 0,
          awaitingReceipt: 0,
          overdueOrders: 0,
          purchasedMonthCents: 0,
          payablePendingCents: 0,
        };
    return purchaseCapabilities(i.role).canViewValues
      ? result
      : { ...result, purchasedMonthCents: null, payablePendingCents: null };
  }

  async closeBalance(
    i: Identity,
    input: {
      publicId: string;
      reason: string;
      discountCents: number;
      freightCents: number;
      otherExpensesCents: number;
    }
  ) {
    this.require(i, "canApprove");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.closeOrderBalance(i as PurchaseActor, input);
    if (!result.replay) await this.publish(i.clientId, input.publicId, "balance_closed");
    return { ...result.order, replay: result.replay };
  }

  async listRequests(i: Identity, input: PurchaseRequestListInput) {
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.listRequests(i.clientId, input);
    return {
      ...result,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(result.total / input.pageSize),
      capabilities: purchaseCapabilities(i.role),
    };
  }

  async requestDetail(i: Identity, publicId: string) {
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.requestDetail(i.clientId, publicId);
    if (!result) throw new ErpDomainError("NOT_FOUND", "Solicitacao nao encontrada.");
    return { ...this.visibleRequest(i, result), capabilities: purchaseCapabilities(i.role) };
  }

  async saveRequest(i: Identity, input: PurchaseRequestDraftInput, publicId?: string) {
    this.require(i, "canCreateRequest");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.saveRequest(i as PurchaseActor, input, publicId);
    if (!result) throw new ErpDomainError("NOT_FOUND", "Solicitacao nao encontrada.");
    await this.publish(i.clientId, result.publicId, publicId ? "updated" : "created");
    return this.visibleRequest(i, result);
  }

  async submitRequest(i: Identity, publicId: string, idempotencyKey: string) {
    this.require(i, "canCreateRequest");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.submitRequest(i as PurchaseActor, publicId, idempotencyKey);
    if (!result.replay) await this.publish(i.clientId, publicId, "approval_requested");
    return { ...this.visibleRequest(i, result.request), replay: result.replay };
  }

  async decideRequest(
    i: Identity,
    publicId: string,
    decision: "approved" | "rejected",
    reason: string | null,
    idempotencyKey: string
  ) {
    this.require(i, "canApprove");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.decideRequest(
      i as PurchaseActor,
      publicId,
      decision,
      reason,
      idempotencyKey
    );
    if (!result.replay) {
      await this.publish(i.clientId, publicId, decision === "approved" ? "approved" : "rejected");
    }
    return { ...this.visibleRequest(i, result.request), replay: result.replay };
  }

  async cancelRequest(i: Identity, publicId: string, reason: string) {
    this.require(i, "canEditRequest");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.cancelRequest(i as PurchaseActor, publicId, reason);
    if (!result.replay) await this.publish(i.clientId, publicId, "cancelled");
    return { ...this.visibleRequest(i, result.request), replay: result.replay };
  }

  async createQuote(i: Identity, requestPublicId: string) {
    this.require(i, "canCreateOrder");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.createQuote(i as PurchaseActor, requestPublicId);
    if (!result.quote) throw new Error("Cotacao nao persistida.");
    if (!result.replay) await this.publish(i.clientId, result.quote.publicId, "quote_created");
    return { ...result.quote, replay: result.replay };
  }

  async quoteDetail(i: Identity, publicId: string) {
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.quoteDetail(i.clientId, publicId);
    if (!result) throw new ErpDomainError("NOT_FOUND", "Cotacao nao encontrada.");
    return this.visibleQuote(i, result);
  }

  async addProposal(i: Identity, input: QuoteProposalInput) {
    this.require(i, "canCreateOrder");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const quote = await workflow.addProposal(i as PurchaseActor, input);
    if (!quote) throw new Error("Proposta nao persistida.");
    await this.publish(i.clientId, input.quotePublicId, "proposal_added");
    return quote;
  }

  async selectProposal(i: Identity, quotePublicId: string, proposalPublicId: string) {
    this.require(i, "canApprove");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.selectProposal(i as PurchaseActor, quotePublicId, proposalPublicId);
    if (!result.quote) throw new Error("Cotacao nao persistida.");
    if (!result.replay) await this.publish(i.clientId, quotePublicId, "supplier_selected");
    return { ...result.quote, replay: result.replay };
  }

  async createFromRequest(i: Identity, input: RequestToOrderInput) {
    this.require(i, "canCreateOrder");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.createOrderFromRequest(i as PurchaseActor, input);
    if (!result.order) throw new Error("Pedido nao persistido.");
    if (!result.replay) await this.publish(i.clientId, result.order.publicId, "created");
    return { ...result.order, replay: result.replay };
  }

  async createFromQuote(i: Identity, input: QuoteToOrderInput) {
    this.require(i, "canCreateOrder");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.createOrderFromQuote(i as PurchaseActor, input);
    if (!result.order) throw new Error("Pedido nao persistido.");
    if (!result.replay) await this.publish(i.clientId, result.order.publicId, "created");
    return { ...result.order, replay: result.replay };
  }

  async linkDocument(
    i: Identity,
    input: Parameters<PurchaseWorkflowRepository["linkDocument"]>[1]
  ) {
    this.require(i, "canCreateRequest");
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.linkDocument(i as PurchaseActor, input);
    if (!result.replay) await this.publish(i.clientId, input.entityPublicId, "document_linked");
    return result;
  }

  async supplierMetrics(i: Identity, supplierPublicId: string) {
    const workflow = this.workflow();
    if (!workflow) throw new ErpDomainError("CONFLICT", "Fluxo integrado indisponivel.");
    const result = await workflow.supplierMetrics(i.clientId, supplierPublicId);
    return purchaseCapabilities(i.role).canViewValues
      ? result
      : {
          ...result,
          purchasedCents: null,
          launchedCents: null,
          paidCents: null,
          pendingCents: null,
          recentOrders: result.recentOrders.map(order => ({ ...order, totalCents: null })),
        };
  }
}
