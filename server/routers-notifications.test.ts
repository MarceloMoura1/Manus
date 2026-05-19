import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDb } from "./db";
import { megadeskNotifications } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Notifications Router", () => {
  const testClientId = "test-client-123";
  const testUserId = "test-user-456";

  beforeAll(async () => {
    // Clean up test data
    const db = getDb();
    await db
      .delete(megadeskNotifications)
      .where(eq(megadeskNotifications.clientId, testClientId));
  });

  afterAll(async () => {
    // Clean up test data
    const db = getDb();
    await db
      .delete(megadeskNotifications)
      .where(eq(megadeskNotifications.clientId, testClientId));
  });

  it("should create a notification", async () => {
    const db = getDb();
    const notificationId = "test-notification-1";

    await db.insert(megadeskNotifications).values({
      notificationId,
      clientId: testClientId,
      userId: testUserId,
      title: "Test Notification",
      message: "This is a test notification",
      type: "info",
      isRead: false,
      createdAt: new Date(),
    });

    const result = await db
      .select()
      .from(megadeskNotifications)
      .where(eq(megadeskNotifications.notificationId, notificationId));

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Test Notification");
    expect(result[0].isRead).toBe(false);
  });

  it("should mark notification as read", async () => {
    const db = getDb();
    const notificationId = "test-notification-2";

    // Create notification
    await db.insert(megadeskNotifications).values({
      notificationId,
      clientId: testClientId,
      userId: testUserId,
      title: "Test Notification 2",
      message: "This is another test notification",
      type: "success",
      isRead: false,
      createdAt: new Date(),
    });

    // Mark as read
    await db
      .update(megadeskNotifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(eq(megadeskNotifications.notificationId, notificationId));

    const result = await db
      .select()
      .from(megadeskNotifications)
      .where(eq(megadeskNotifications.notificationId, notificationId));

    expect(result[0].isRead).toBe(true);
    expect(result[0].readAt).toBeDefined();
  });

  it("should delete notification", async () => {
    const db = getDb();
    const notificationId = "test-notification-3";

    // Create notification
    await db.insert(megadeskNotifications).values({
      notificationId,
      clientId: testClientId,
      userId: testUserId,
      title: "Test Notification 3",
      message: "This notification will be deleted",
      type: "warning",
      isRead: false,
      createdAt: new Date(),
    });

    // Delete notification
    await db
      .delete(megadeskNotifications)
      .where(eq(megadeskNotifications.notificationId, notificationId));

    const result = await db
      .select()
      .from(megadeskNotifications)
      .where(eq(megadeskNotifications.notificationId, notificationId));

    expect(result).toHaveLength(0);
  });

  it("should get notifications filtered by clientId and userId", async () => {
    const db = getDb();

    // Create multiple notifications
    for (let i = 0; i < 3; i++) {
      await db.insert(megadeskNotifications).values({
        notificationId: `test-notification-filter-${i}`,
        clientId: testClientId,
        userId: testUserId,
        title: `Test Notification ${i}`,
        message: `This is test notification ${i}`,
        type: "info",
        isRead: false,
        createdAt: new Date(),
      });
    }

    // Get notifications
    const result = await db
      .select()
      .from(megadeskNotifications)
      .where(
        eq(megadeskNotifications.clientId, testClientId) &&
        eq(megadeskNotifications.userId, testUserId)
      );

    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
