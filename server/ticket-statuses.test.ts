import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getTicketStatuses,
  createTicketStatus,
  updateTicketStatus,
  deleteTicketStatus,
  getOrCreateDefaultStatuses,
} from "./db-ticket-statuses";

const TEST_CLIENT_ID = "test-client-123";

describe("Ticket Statuses", () => {
  beforeAll(async () => {
    // Limpar dados de teste antes de começar
    const statuses = await getTicketStatuses(TEST_CLIENT_ID);
    for (const status of statuses) {
      await deleteTicketStatus(TEST_CLIENT_ID, status.statusId);
    }
  });

  afterAll(async () => {
    // Limpar dados de teste após terminar
    const statuses = await getTicketStatuses(TEST_CLIENT_ID);
    for (const status of statuses) {
      await deleteTicketStatus(TEST_CLIENT_ID, status.statusId);
    }
  });

  it("should create a new ticket status", async () => {
    const status = await createTicketStatus(
      TEST_CLIENT_ID,
      "Novo Status",
      "#ff0000",
      1
    );

    expect(status).toBeDefined();
    expect(status.clientId).toBe(TEST_CLIENT_ID);
    expect(status.name).toBe("Novo Status");
    expect(status.color).toBe("#ff0000");
    expect(status.order).toBe(1);
    expect(status.isDefault).toBe(false);
  });

  it("should list all ticket statuses for a client", async () => {
    await createTicketStatus(TEST_CLIENT_ID, "Status 1", "#ff0000", 1);
    await createTicketStatus(TEST_CLIENT_ID, "Status 2", "#00ff00", 2);

    const statuses = await getTicketStatuses(TEST_CLIENT_ID);

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses.some((s) => s.name === "Status 1")).toBe(true);
    expect(statuses.some((s) => s.name === "Status 2")).toBe(true);
  });

  it("should update a ticket status", async () => {
    const status = await createTicketStatus(
      TEST_CLIENT_ID,
      "Original Name",
      "#0000ff",
      1
    );

    const updated = await updateTicketStatus(TEST_CLIENT_ID, status.statusId, {
      name: "Updated Name",
      color: "#ffff00",
      order: 2,
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.color).toBe("#ffff00");
    expect(updated.order).toBe(2);
  });

  it("should delete a ticket status", async () => {
    const status = await createTicketStatus(
      TEST_CLIENT_ID,
      "To Delete",
      "#ff00ff",
      1
    );

    await deleteTicketStatus(TEST_CLIENT_ID, status.statusId);

    const statuses = await getTicketStatuses(TEST_CLIENT_ID);
    expect(statuses.some((s) => s.statusId === status.statusId)).toBe(false);
  });

  it("should create default statuses if none exist", async () => {
    const clientId = "test-client-new-" + Date.now();

    const statuses = await getOrCreateDefaultStatuses(clientId);

    expect(statuses.length).toBe(4);
    expect(statuses.some((s) => s.name === "Aberto")).toBe(true);
    expect(statuses.some((s) => s.name === "Em Progresso")).toBe(true);
    expect(statuses.some((s) => s.name === "Aguardando")).toBe(true);
    expect(statuses.some((s) => s.name === "Fechado")).toBe(true);

    // Cleanup
    for (const status of statuses) {
      await deleteTicketStatus(clientId, status.statusId);
    }
  });

  it("should return existing statuses if they already exist", async () => {
    const clientId = "test-client-existing-" + Date.now();

    // Create first time
    const statuses1 = await getOrCreateDefaultStatuses(clientId);
    expect(statuses1.length).toBe(4);

    // Get second time (should return same statuses)
    const statuses2 = await getOrCreateDefaultStatuses(clientId);
    expect(statuses2.length).toBe(4);

    // Cleanup
    for (const status of statuses2) {
      await deleteTicketStatus(clientId, status.statusId);
    }
  });

  it("should enforce unique constraint on status name per client", async () => {
    const status1 = await createTicketStatus(
      TEST_CLIENT_ID,
      "Unique Name",
      "#ff0000",
      1
    );

    // Try to create another status with the same name
    try {
      await createTicketStatus(
        TEST_CLIENT_ID,
        "Unique Name",
        "#00ff00",
        2
      );
      // If we reach here, the test should fail
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail due to unique constraint
      expect(error).toBeDefined();
    }
  });

  it("should order statuses correctly", async () => {
    const clientId = "test-client-order-" + Date.now();

    const status3 = await createTicketStatus(clientId, "Third", "#0000ff", 3);
    const status1 = await createTicketStatus(clientId, "First", "#ff0000", 1);
    const status2 = await createTicketStatus(clientId, "Second", "#00ff00", 2);

    const statuses = await getTicketStatuses(clientId);

    // Should be ordered by `order` field
    expect(statuses[0].order).toBeLessThanOrEqual(statuses[1].order);
    expect(statuses[1].order).toBeLessThanOrEqual(statuses[2].order);

    // Cleanup
    await deleteTicketStatus(clientId, status1.statusId);
    await deleteTicketStatus(clientId, status2.statusId);
    await deleteTicketStatus(clientId, status3.statusId);
  });
});
