import { router, megadeskProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { megadeskNotifications } from "../drizzle/schema";

import { eq, and, desc, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Removed unused userId function

const notificationTypes = ["info", "success", "warning", "error", "system"] as const;
const safeActionUrl = (value: string | null): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split("?")[0].replace(/\/+$/, "") || "/";
  const allowed = ["/", "/chamados", "/conversas", "/notificacoes", "/erp", "/erp/produtos", "/erp/estoque", "/erp/fornecedores", "/erp/compras", "/erp/vendas", "/erp/financeiro", "/erp/clientes"];
  return allowed.includes(path) ? value : null;
};

function authoritativeIdentity(ctx: { tenantId?: string; operationalUserId?: string }) {
  if (!ctx.tenantId || !ctx.operationalUserId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Identidade operacional ausente" });
  return { clientId: ctx.tenantId, userId: ctx.operationalUserId };
}

export const notificationsRouter = router({
  listV2: megadeskProcedure.input(z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(10).max(50).default(20),
    unreadOnly: z.boolean().default(false),
    category: z.enum(notificationTypes).optional(),
  })).query(async ({ input, ctx }) => {
    try {
      const db = getDb();
      const { clientId, userId } = authoritativeIdentity(ctx);
      const base = [eq(megadeskNotifications.clientId, clientId), eq(megadeskNotifications.userId, userId)];
      const filtered = [...base, ...(input.unreadOnly ? [eq(megadeskNotifications.isRead, false)] : []), ...(input.category ? [eq(megadeskNotifications.type, input.category)] : [])];
      const [items, totalRows, unreadRows] = await Promise.all([
        db.select().from(megadeskNotifications).where(and(...filtered)).orderBy(desc(megadeskNotifications.createdAt), desc(megadeskNotifications.notificationId)).limit(input.pageSize).offset((input.page - 1) * input.pageSize),
        db.select({ value: count() }).from(megadeskNotifications).where(and(...filtered)),
        db.select({ value: count() }).from(megadeskNotifications).where(and(...base, eq(megadeskNotifications.isRead, false))),
      ]);
      const total = Number(totalRows[0]?.value ?? 0);
      const unreadCount = Number(unreadRows[0]?.value ?? 0);
      return { items: items.map(item => ({ ...item, actionUrl: safeActionUrl(item.actionUrl) })), total, unreadCount, page: input.page, pageSize: input.pageSize, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("[Notifications] list failed");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível carregar as notificações." });
    }
  }),

  markAsReadV2: megadeskProcedure.input(z.object({ notificationId: z.string().min(1).max(80) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const { clientId, userId } = authoritativeIdentity(ctx);
    const scoped = and(eq(megadeskNotifications.notificationId, input.notificationId), eq(megadeskNotifications.clientId, clientId), eq(megadeskNotifications.userId, userId));
    const found = await db.select({ notificationId: megadeskNotifications.notificationId }).from(megadeskNotifications).where(scoped).limit(1);
    if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada" });
    await db.update(megadeskNotifications).set({ isRead: true, readAt: new Date().toISOString().slice(0, 19).replace("T", " ") }).where(scoped);
    return { success: true };
  }),

  markAllAsReadV2: megadeskProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const { clientId, userId } = authoritativeIdentity(ctx);
    await db.update(megadeskNotifications).set({ isRead: true, readAt: new Date().toISOString().slice(0, 19).replace("T", " ") }).where(and(eq(megadeskNotifications.clientId, clientId), eq(megadeskNotifications.userId, userId), eq(megadeskNotifications.isRead, false)));
    return { success: true };
  }),

  // Get all notifications for current user
  getNotifications: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        limit: z.number().default(50),
        offset: z.number().default(0),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userId = ctx.operationalUserId;
        if (!userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Identidade operacional ausente" });
        
        // Filter by clientId only (notifications are already scoped to client)
        const whereConditions = [
          eq(megadeskNotifications.clientId, ctx.tenantId),
          eq(megadeskNotifications.userId, userId),
        ];
        
        if (input.unreadOnly) {
          whereConditions.push(eq(megadeskNotifications.isRead, false));
        }

        const query = dbInstance
          .select()
          .from(megadeskNotifications)
          .where(and(...whereConditions))
          .orderBy(desc(megadeskNotifications.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        const notifications = await query;
        
        // Get total count
        const countConditions = [
          eq(megadeskNotifications.clientId, ctx.tenantId),
          eq(megadeskNotifications.userId, userId),
        ];
        
        if (input.unreadOnly) {
          countConditions.push(eq(megadeskNotifications.isRead, false));
        }

        const countQuery = dbInstance
          .select()
          .from(megadeskNotifications)
          .where(and(...countConditions));
        
        const countResult = await countQuery;
        const total = countResult.length;

        return {
          notifications: notifications.map((notification) => ({
            ...notification,
            createdAt: new Date(notification.createdAt),
            readAt: notification.readAt ? new Date(notification.readAt) : null,
          })),
          total,
          unreadCount: notifications.filter((notification) => !notification.isRead).length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error fetching notifications:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao buscar notificações",
        });
      }
    }),

  // Mark notification as read
  markAsRead: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        notificationId: z.string(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Use o contrato markAsReadV2.",
      });
    }),

  // Delete notification
  deleteNotification: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        notificationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userIdStr = ctx.operationalUserId;
        if (!userIdStr) throw new TRPCError({ code: "UNAUTHORIZED", message: "Identidade operacional ausente" });
        
        // Verify notification belongs to user
        const notification = await dbInstance
          .select()
          .from(megadeskNotifications)
          .where(
            and(
              eq(megadeskNotifications.notificationId, input.notificationId),
              eq(megadeskNotifications.clientId, ctx.tenantId),
              eq(megadeskNotifications.userId, userIdStr)
            )
          );

        if (!notification || notification.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Notificação não encontrada",
          });
        }

        await dbInstance
          .delete(megadeskNotifications)
          .where(and(
            eq(megadeskNotifications.notificationId, input.notificationId),
            eq(megadeskNotifications.clientId, ctx.tenantId),
            eq(megadeskNotifications.userId, userIdStr),
          ));

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting notification:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao deletar notificação",
        });
      }
    }),

  // Mark all as read
  markAllAsRead: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userIdStr = ctx.operationalUserId;
        if (!userIdStr) throw new TRPCError({ code: "UNAUTHORIZED", message: "Identidade operacional ausente" });
        
        const updateConditions = [
          eq(megadeskNotifications.clientId, ctx.tenantId),
          eq(megadeskNotifications.userId, userIdStr),
          eq(megadeskNotifications.isRead, false),
        ];

        await dbInstance
          .update(megadeskNotifications)
          .set({
            isRead: true,
            readAt: new Date().toISOString().slice(0, 19).replace("T", " "),
          })
          .where(and(...updateConditions));

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error marking all notifications as read:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao marcar todas as notificações como lidas",
        });
      }
    }),

  // Create notification (for testing)
  createNotification: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        title: z.string(),
        message: z.string(),
        type: z.enum(["info", "success", "warning", "error", "system"]).default("info"),
        actionUrl: z.string().optional(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Criação direta de notificações está desabilitada.",
      });
    }),
});
