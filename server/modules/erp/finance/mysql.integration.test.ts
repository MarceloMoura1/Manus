import { beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import {
  applyCanonicalMigrations,
  MAIN_MIGRATIONS_DIR,
} from "../../../_core/canonical-migrations";
import { getPool } from "../../../db";
import {
  getTestDatabaseUrl,
  isTestDatabaseEnabled,
} from "../../../test-integration-gates";
import { FinanceRepository } from "./repository";
import { FinanceService, type FinanceEventPublisher } from "./service";

const physical = describe.runIf(isTestDatabaseEnabled()),
  tenantA = `finance-a`,
  tenantB = `finance-b`,
  admin = {
    clientId: tenantA,
    userId: "finance-admin",
    role: "admin" as const,
  },
  manager = { ...admin, userId: "finance-manager", role: "manager" as const },
  viewer = { ...admin, userId: "finance-viewer", role: "viewer" as const },
  agent = { ...admin, userId: "finance-agent", role: "agent" as const };
let serial = 0;
async function clean() {
  const db = getPool(),
    tenants = [tenantA, tenantB];
  for (const sql of [
    "DELETE FROM erp_financial_ledger WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_settlements WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_entries WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_categories WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_accounts WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
  ])
    await db.execute(sql, tenants);
}
async function isolated(
  run: (context: {
    service: FinanceService;
    repository: FinanceRepository;
    events: Array<{ event: string; payload: Record<string, string> }>;
  }) => Promise<void>
) {
  const events: Array<{ event: string; payload: Record<string, string> }> = [],
    publisher: FinanceEventPublisher = {
      publish: (_clientId, event, payload) => {
        events.push({ event, payload });
      },
    },
    repository = new FinanceRepository(),
    service = new FinanceService(repository, publisher);
  await clean();
  try {
    await run({ service, repository, events });
  } finally {
    await clean();
  }
}
async function accountAndCategory(
  service: FinanceService,
  {
    balance = 10000,
    allowNegative = false,
    direction = "both" as "both" | "payable" | "receivable",
  } = {}
) {
  serial++;
  const account = await service.createAccount(admin, {
      name: `Conta ${serial}`,
      type: "bank",
      initialBalanceCents: balance,
      allowNegative,
    }),
    category = await service.createCategory(admin, {
      name: `Categoria ${serial}`,
      direction,
    });
  return {
    accountPublicId: account.publicId,
    categoryPublicId: category.publicId,
  };
}
async function manual(
  service: FinanceService,
  direction: "payable" | "receivable" = "payable",
  amountCents = 2500
) {
  const refs = await accountAndCategory(service);
  const entry = await service.createManual(admin, {
    documentNumber: `MAN-${++serial}`,
    direction,
    description: "Título físico controlado",
    amountCents,
    dueDate: "2026-09-10",
    issueDate: "2026-08-24",
    categoryPublicId: refs.categoryPublicId,
    financialAccountPublicId: refs.accountPublicId,
    supplierPublicId: null,
    crmClientId: null,
    partyName: "Parte física",
    notes: null,
  });
  return { ...refs, entry };
}
async function purchase(
  status: "draft" | "approved" | "received" | "cancelled" = "received"
) {
  const db = getPool(),
    supplierPublicId = crypto.randomUUID(),
    orderPublicId = crypto.randomUUID();
  serial++;
  const [supplier] = await db.execute<any>(
    "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by,updated_by) VALUES(?,?,?,'legal',?,1,?,?)",
    [
      supplierPublicId,
      tenantA,
      `Fornecedor ${serial}`,
      String(10000000000000 + serial),
      admin.userId,
      admin.userId,
    ]
  );
  await db.execute(
    "INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      orderPublicId,
      tenantA,
      `PO-${serial}`,
      supplier.insertId,
      `Fornecedor ${serial}`,
      status,
      7300,
      7300,
      admin.userId,
    ]
  );
  return orderPublicId;
}
async function sale(
  status: "draft" | "confirmed" | "fulfilled" | "cancelled" = "fulfilled"
) {
  const db = getPool(),
    crmClientId = crypto.randomUUID(),
    orderPublicId = crypto.randomUUID();
  serial++;
  await db.execute(
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES(?,?,?,'ativo')",
    [crmClientId, tenantA, `Cliente ${serial}`]
  );
  await db.execute(
    "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      orderPublicId,
      tenantA,
      `SO-${serial}`,
      crmClientId,
      `Cliente ${serial}`,
      status,
      9100,
      9100,
      admin.userId,
    ]
  );
  return orderPublicId;
}
async function counts() {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM erp_financial_settlements WHERE client_id=?) settlements,(SELECT COUNT(*) FROM erp_financial_ledger WHERE client_id=? AND financial_entry_id IS NOT NULL) entryLedger",
    [tenantA, tenantA]
  );
  return {
    settlements: Number(rows[0].settlements),
    entryLedger: Number(rows[0].entryLedger),
  };
}

physical("finance MySQL executable conditional matrix", () => {
  beforeAll(async () => {
    await applyCanonicalMigrations(getTestDatabaseUrl(), MAIN_MIGRATIONS_DIR);
  }, 60_000);
  it("01 creates account and explicit opening_balance", () =>
    isolated(async ({ service, repository }) => {
      const refs = await accountAndCategory(service, { balance: 12345 });
      const ledger = await repository.ledger(tenantA, refs.accountPublicId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        type: "opening_balance",
        amountCents: 12345,
        previousBalanceCents: 0,
        resultingBalanceCents: 12345,
      });
    }));
  it("02 creates compatible category and tenant-aware manual title", () =>
    isolated(async ({ service }) => {
      const f = await manual(service);
      expect(f.entry).toMatchObject({
        direction: "payable",
        status: "open",
        amountCents: 2500,
        partyName: "Parte física",
      });
      expect(f.entry).not.toHaveProperty("clientId");
    }));
  it("03 creates payable only from a received purchase with authoritative total", () =>
    isolated(async ({ service }) => {
      const refs = await accountAndCategory(service),
        sourcePublicId = await purchase(),
        entry = await service.createFromSource(manager, "purchase_order", {
          sourcePublicId,
          dueDate: "2026-09-10",
          categoryPublicId: refs.categoryPublicId,
          financialAccountPublicId: refs.accountPublicId,
          notes: null,
        });
      expect(entry).toMatchObject({
        direction: "payable",
        amountCents: 7300,
        sourcePublicId,
        replay: false,
      });
    }));
  it("04 creates receivable only from a fulfilled sale with authoritative total", () =>
    isolated(async ({ service }) => {
      const refs = await accountAndCategory(service),
        sourcePublicId = await sale(),
        entry = await service.createFromSource(admin, "sales_order", {
          sourcePublicId,
          dueDate: "2026-09-10",
          categoryPublicId: refs.categoryPublicId,
          financialAccountPublicId: null,
          notes: null,
        });
      expect(entry).toMatchObject({
        direction: "receivable",
        amountCents: 9100,
        sourcePublicId,
        replay: false,
      });
    }));
  it("05 rejects purchase and sale sources in invalid states", () =>
    isolated(async ({ service }) => {
      const refs = await accountAndCategory(service),
        p = await purchase("approved"),
        s = await sale("confirmed");
      for (const [kind, id] of [
        ["purchase_order", p],
        ["sales_order", s],
      ] as const)
        await expect(
          service.createFromSource(admin, kind, {
            sourcePublicId: id,
            dueDate: "2026-09-10",
            categoryPublicId: refs.categoryPublicId,
            financialAccountPublicId: null,
            notes: null,
          })
        ).rejects.toMatchObject({ code: "CONFLICT" });
    }));
  it("06 replays duplicate origin without a second title or event", () =>
    isolated(async ({ service, events }) => {
      const refs = await accountAndCategory(service),
        sourcePublicId = await purchase(),
        input = {
          sourcePublicId,
          dueDate: "2026-09-10",
          categoryPublicId: refs.categoryPublicId,
          financialAccountPublicId: null,
          notes: null,
        },
        first = await service.createFromSource(admin, "purchase_order", input),
        second = await service.createFromSource(admin, "purchase_order", input);
      expect(second).toMatchObject({ publicId: first.publicId, replay: true });
      expect(
        events.filter(e => e.event === "erp:finance.entry.changed")
      ).toHaveLength(1);
    }));
  it("07 payable settlement reduces balance and creates coherent immutable ledger", () =>
    isolated(async ({ service, repository }) => {
      const f = await manual(service, "payable", 2500),
        settled = await service.settle(
          admin,
          f.entry!.publicId,
          f.accountPublicId,
          crypto.randomUUID()
        ),
        ledger = await repository.ledger(tenantA, f.accountPublicId);
      expect(settled.status).toBe("settled");
      expect(ledger[0]).toMatchObject({
        type: "payable_settlement",
        amountCents: -2500,
        resultingBalanceCents: 7500,
      });
      expect(await counts()).toEqual({ settlements: 1, entryLedger: 1 });
    }));
  it("08 receivable settlement increases balance and locks terminal state", () =>
    isolated(async ({ service, repository }) => {
      const f = await manual(service, "receivable", 2500),
        settled = await service.settle(
          manager,
          f.entry!.publicId,
          f.accountPublicId,
          crypto.randomUUID()
        ),
        ledger = await repository.ledger(tenantA, f.accountPublicId);
      expect(ledger[0]).toMatchObject({
        type: "receivable_settlement",
        resultingBalanceCents: 12500,
      });
      await expect(
        service.cancel(admin, settled.publicId, "não permitido")
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }));
  it("09 enforces allow_negative, inactive account and write roles", () =>
    isolated(async ({ service }) => {
      const blocked = await manual(service, "payable", 11000);
      await expect(
        service.settle(
          admin,
          blocked.entry!.publicId,
          blocked.accountPublicId,
          crypto.randomUUID()
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const allowed = await accountAndCategory(service, {
          balance: 0,
          allowNegative: true,
        }),
        entry = await service.createManual(admin, {
          documentNumber: `NEG-${++serial}`,
          direction: "payable",
          description: "Negativo",
          amountCents: 100,
          dueDate: "2026-09-10",
          issueDate: "2026-08-24",
          categoryPublicId: allowed.categoryPublicId,
          financialAccountPublicId: null,
          supplierPublicId: null,
          crmClientId: null,
          partyName: null,
          notes: null,
        });
      expect(
        (
          await service.settle(
            manager,
            entry!.publicId,
            allowed.accountPublicId,
            crypto.randomUUID()
          )
        ).status
      ).toBe("settled");
      const inactive = await manual(service);
      await service.setAccountActive(admin, inactive.accountPublicId, false);
      await expect(
        service.settle(
          admin,
          inactive.entry!.publicId,
          inactive.accountPublicId,
          crypto.randomUUID()
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        service.createCategory(viewer, { name: "Vedada", direction: "both" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.options(agent)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }));
  it("10 rolls back settlement fully and emits nothing on failure", () =>
    isolated(async ({ service, events }) => {
      const f = await manual(service, "payable", 20000),
        before = events.length;
      await expect(
        service.settle(
          admin,
          f.entry!.publicId,
          f.accountPublicId,
          crypto.randomUUID()
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await counts()).toEqual({ settlements: 0, entryLedger: 0 });
      expect((await service.detail(admin, f.entry!.publicId)).status).toBe(
        "open"
      );
      expect(events).toHaveLength(before);
    }));
  it("11 replays settlement idempotently without duplicate ledger or event", () =>
    isolated(async ({ service, events }) => {
      const f = await manual(service),
        key = crypto.randomUUID(),
        first = await service.settle(
          admin,
          f.entry!.publicId,
          f.accountPublicId,
          key
        ),
        eventCount = events.length,
        second = await service.settle(
          admin,
          f.entry!.publicId,
          f.accountPublicId,
          key
        );
      expect(second).toMatchObject({ publicId: first.publicId, replay: true });
      expect(await counts()).toEqual({ settlements: 1, entryLedger: 1 });
      expect(events).toHaveLength(eventCount);
    }));
  it("12 serializes concurrent settlements of the same title", () =>
    isolated(async ({ service, repository }) => {
      const f = await manual(service, "payable", 2500),
        attempts = await Promise.allSettled([
          service.settle(
            admin,
            f.entry!.publicId,
            f.accountPublicId,
            crypto.randomUUID()
          ),
          service.settle(
            manager,
            f.entry!.publicId,
            f.accountPublicId,
            crypto.randomUUID()
          ),
        ]),
        fulfilled = attempts.filter(x => x.status === "fulfilled"),
        rejected = attempts.filter(x => x.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFLICT",
      });
      expect(await counts()).toEqual({ settlements: 1, entryLedger: 1 });
      expect(await repository.ledger(tenantA, f.accountPublicId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "payable_settlement",
            resultingBalanceCents: 7500,
          }),
        ])
      );
    }));
  it("13 serializes two payables competing for limited balance", () =>
    isolated(async ({ service, repository }) => {
      const refs = await accountAndCategory(service, { balance: 5000 }),
        makeEntry = (documentNumber: string) =>
          service.createManual(admin, {
            documentNumber,
            direction: "payable",
            description: `Disputa ${documentNumber}`,
            amountCents: 4000,
            dueDate: "2026-09-10",
            issueDate: "2026-08-24",
            categoryPublicId: refs.categoryPublicId,
            financialAccountPublicId: refs.accountPublicId,
            supplierPublicId: null,
            crmClientId: null,
            partyName: null,
            notes: null,
          }),
        [first, second] = await Promise.all([
          makeEntry(`RACE-A-${++serial}`),
          makeEntry(`RACE-B-${++serial}`),
        ]),
        attempts = await Promise.allSettled([
          service.settle(
            admin,
            first!.publicId,
            refs.accountPublicId,
            crypto.randomUUID()
          ),
          service.settle(
            manager,
            second!.publicId,
            refs.accountPublicId,
            crypto.randomUUID()
          ),
        ]);
      expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(x => x.status === "rejected")).toHaveLength(1);
      expect(await counts()).toEqual({ settlements: 1, entryLedger: 1 });
      const ledger = await repository.ledger(tenantA, refs.accountPublicId);
      expect(ledger.filter(x => x.type === "payable_settlement")).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ resultingBalanceCents: 1000 });
    }));
});
