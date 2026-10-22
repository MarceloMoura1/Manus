import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  megadeskCrmPipelines,
  megadeskCrmStages,
  megadeskCrmOpportunities,
  megadeskCrmActivities,
  megadeskCrmOpportunityHistory,
} from "../drizzle/schema";
import {
  pipelineCreateInput,
  stageCreateInput,
} from "./modules/crm/pipeline/contracts";
import {
  opportunityCreateInput,
  opportunityUpdateInput,
  activityCreateInput,
} from "./modules/crm/opportunities/contracts";

describe("MegaDesk CRM — Schema Structure & Multi-Tenant Integrity (Etapa 2B.2)", () => {
  const tables = [
    { name: "megadesk_crm_pipelines", table: megadeskCrmPipelines },
    { name: "megadesk_crm_stages", table: megadeskCrmStages },
    { name: "megadesk_crm_opportunities", table: megadeskCrmOpportunities },
    { name: "megadesk_crm_activities", table: megadeskCrmActivities },
    {
      name: "megadesk_crm_opportunity_history",
      table: megadeskCrmOpportunityHistory,
    },
  ];

  it("exports all five dedicated CRM tables", () => {
    expect(megadeskCrmPipelines).toBeDefined();
    expect(megadeskCrmStages).toBeDefined();
    expect(megadeskCrmOpportunities).toBeDefined();
    expect(megadeskCrmActivities).toBeDefined();
    expect(megadeskCrmOpportunityHistory).toBeDefined();
  });

  for (const { name, table } of tables) {
    it(`enforces mandatory multi-tenant client_id on ${name}`, () => {
      const cols = getTableColumns(table);
      expect(cols.clientId).toBeDefined();
      expect(cols.clientId.name).toBe("client_id");
      expect(cols.clientId.notNull).toBe(true);
    });

    it(`enforces public_id UUID on ${name}`, () => {
      const cols = getTableColumns(table);
      expect(cols.publicId).toBeDefined();
      expect(cols.publicId.name).toBe("public_id");
      expect(cols.publicId.notNull).toBe(true);
    });

    it(`enforces primary key id on ${name}`, () => {
      const cols = getTableColumns(table);
      expect(cols.id).toBeDefined();
      expect(cols.id.name).toBe("id");
      expect(cols.id.primary).toBe(true);
      expect(cols.id.notNull).toBe(true);
    });
  }

  it("configures megadesk_crm_pipelines with default marker and ordering", () => {
    const cols = getTableColumns(megadeskCrmPipelines);
    expect(cols.name).toBeDefined();
    expect(cols.name.notNull).toBe(true);
    expect(cols.isDefault).toBeDefined();
    expect(cols.isDefault.notNull).toBe(true);
    expect(cols.defaultMarker).toBeDefined();
    expect(cols.displayOrder).toBeDefined();
    expect(cols.isActive).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("configures megadesk_crm_stages with probability, color and SLA", () => {
    const cols = getTableColumns(megadeskCrmStages);
    expect(cols.pipelineId).toBeDefined();
    expect(cols.pipelineId.name).toBe("pipeline_id");
    expect(cols.name).toBeDefined();
    expect(cols.probabilityPct).toBeDefined();
    expect(cols.color).toBeDefined();
    expect(cols.slaDays).toBeDefined();
    expect(cols.slaDays.notNull).toBe(false);
  });

  it("configures megadesk_crm_opportunities with integer value_cents and status enum", () => {
    const cols = getTableColumns(megadeskCrmOpportunities);
    expect(cols.pipelineId).toBeDefined();
    expect(cols.stageId).toBeDefined();
    expect(cols.crmClientId).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.valueCents).toBeDefined();
    expect(cols.valueCents.name).toBe("value_cents");
    expect(cols.currency).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.lossReason).toBeDefined();
    expect(cols.internalResponsible).toBeDefined();
  });

  it("configures megadesk_crm_activities with types and link columns", () => {
    const cols = getTableColumns(megadeskCrmActivities);
    expect(cols.opportunityId).toBeDefined();
    expect(cols.opportunityId.notNull).toBe(false);
    expect(cols.crmClientId).toBeDefined();
    expect(cols.crmClientId.notNull).toBe(false);
    expect(cols.type).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.assignedTo).toBeDefined();
  });

  it("configures megadesk_crm_opportunity_history as append-only (no updatedAt)", () => {
    const cols = getTableColumns(megadeskCrmOpportunityHistory);
    expect(cols.opportunityId).toBeDefined();
    expect(cols.fromStageId).toBeDefined();
    expect(cols.toStageId).toBeDefined();
    expect(cols.fromValueCents).toBeDefined();
    expect(cols.toValueCents).toBeDefined();
    expect(cols.author).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect((cols as Record<string, unknown>).updatedAt).toBeUndefined();
  });
});

describe("MegaDesk CRM — Zod Contracts Validation (Etapa 2B.2)", () => {
  it("validates pipeline creation and rejects invalid inputs", () => {
    const valid = pipelineCreateInput.safeParse({
      name: "Funil Comercial Principal",
      isDefault: true,
      displayOrder: 1,
    });
    expect(valid.success).toBe(true);

    const emptyName = pipelineCreateInput.safeParse({
      name: "   ",
    });
    expect(emptyName.success).toBe(false);
  });

  it("validates stage creation and probability boundaries (0-100%)", () => {
    const valid = stageCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      name: "Proposta Enviada",
      probabilityPct: 50,
      color: "#10B981",
      slaDays: 7,
    });
    expect(valid.success).toBe(true);

    const over100 = stageCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      name: "Proposta",
      probabilityPct: 101,
    });
    expect(over100.success).toBe(false);

    const negative = stageCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      name: "Proposta",
      probabilityPct: -5,
    });
    expect(negative.success).toBe(false);

    const invalidHex = stageCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      name: "Proposta",
      color: "not-a-color",
    });
    expect(invalidHex.success).toBe(false);
  });

  it("validates opportunity monetary representation in positive integer cents", () => {
    const valid = opportunityCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      stagePublicId: "22222222-2222-4222-8222-222222222222",
      title: "Contrato Anual MegaCorp",
      valueCents: 1500000, // R$ 15.000,00
      expectedCloseDate: "2026-12-31",
    });
    expect(valid.success).toBe(true);

    const negativeCents = opportunityCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      stagePublicId: "22222222-2222-4222-8222-222222222222",
      title: "Negócio Inválido",
      valueCents: -500,
    });
    expect(negativeCents.success).toBe(false);

    const floatCents = opportunityCreateInput.safeParse({
      pipelinePublicId: "11111111-1111-4111-8111-111111111111",
      stagePublicId: "22222222-2222-4222-8222-222222222222",
      title: "Negócio Float",
      valueCents: 150.5,
    });
    expect(floatCents.success).toBe(false);
  });

  it("enforces lossReason when updating opportunity status to lost", () => {
    const validLost = opportunityUpdateInput.safeParse({
      opportunityPublicId: "33333333-3333-4333-8333-333333333333",
      status: "lost",
      lossReason: "Optou por concorrente com preço mais baixo",
    });
    expect(validLost.success).toBe(true);

    const invalidLostWithoutReason = opportunityUpdateInput.safeParse({
      opportunityPublicId: "33333333-3333-4333-8333-333333333333",
      status: "lost",
      lossReason: "",
    });
    expect(invalidLostWithoutReason.success).toBe(false);
  });

  it("enforces at least one entity link (opportunity or client) on activities", () => {
    const withOpp = activityCreateInput.safeParse({
      opportunityPublicId: "33333333-3333-4333-8333-333333333333",
      type: "call",
      title: "Ligar para decisor",
    });
    expect(withOpp.success).toBe(true);

    const withClient = activityCreateInput.safeParse({
      crmClientId: "crm-cli-001",
      type: "meeting",
      title: "Reunião de alinhamento",
    });
    expect(withClient.success).toBe(true);

    const orphan = activityCreateInput.safeParse({
      type: "task",
      title: "Tarefa sem vínculo",
    });
    expect(orphan.success).toBe(false);
  });
});

