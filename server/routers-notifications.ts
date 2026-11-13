import { router, megadeskProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { megadeskNotifications } from "../drizzle/schema";
import { eq, and, desc, count, or, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  getUserSettings,
  updateUserNotificationSettings,
} from "./db-user-settings";

const notificationTypes = [
  "info",
  "success",
  "warning",
  "error",
  "system",
] as const;

const safeActionUrl = (value: string | null): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split("?")[0].replace(/\/+$/, "") || "/";
  const allowed = [
    "/",
    "/chamados",
    "/conversas",
    "/notificacoes",
    "/crm/leads",
    "/crm/quotes",
    "/erp",
    "/erp/produtos",
    "/erp/estoque",
    "/erp/fornecedores",
    "/erp/compras",
    "/erp/vendas",
    "/erp/financeiro",
    "/erp/fiscal",
    "/erp/relatorios",
    "/erp/clientes",
    "/assistente-ia",
    "/settings",
  ];
  return allowed.includes(path) ||
    path.startsWith("/conversas/") ||
    path.startsWith("/chamados/")
    ? value
    : null;
};

function authoritativeIdentity(ctx: {
  tenantId?: string;
  operationalUserId?: string;
}) {
  if (!ctx.tenantId || !ctx.operationalUserId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Identidade operacional ausente",
    });
  return { clientId: ctx.tenantId, userId: ctx.operationalUserId };
}

export const notificationsRouter = router({
  listV2: megadeskProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(50).default(20),
        unreadOnly: z.boolean().default(false),
        category: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const db = getDb();
        const { clientId, userId } = authoritativeIdentity(ctx);
        const base = [
          eq(megadeskNotifications.clientId, clientId),
          eq(megadeskNotifications.userId, userId),
        ];

        const categoryFilter = (() => {
          if (!input.category || input.category === "all") return [];
          if (notificationTypes.includes(input.category as any)) {
            return [eq(megadeskNotifications.type, input.category as any)];
          }
          if (input.category === "messages") {
            return [
              or(
                like(megadeskNotifications.title, "%WhatsApp%"),
                like(megadeskNotifications.title, "%Mensagem%"),
                like(megadeskNotifications.actionUrl, "%/conversas%")
              ),
            ];
          }
          if (input.category === "leads") {
            return [
              or(
                like(megadeskNotifications.title, "%Lead%"),
                like(megadeskNotifications.title, "%Orçamento%"),
                like(megadeskNotifications.title, "%Venda%"),
                like(megadeskNotifications.actionUrl, "%/crm%"),
                like(megadeskNotifications.actionUrl, "%/erp/vendas%")
              ),
            ];
          }
          if (input.category === "tickets") {
            return [
              or(
                like(megadeskNotifications.title, "%Chamado%"),
                like(megadeskNotifications.title, "%Ticket%"),
                like(megadeskNotifications.title, "%SLA%"),
                like(megadeskNotifications.actionUrl, "%/chamados%")
              ),
            ];
          }
          if (input.category === "ai") {
            return [
              or(
                like(megadeskNotifications.title, "%Rotina%"),
                like(megadeskNotifications.title, "%IA%"),
                like(megadeskNotifications.title, "%Assistente%"),
                like(megadeskNotifications.actionUrl, "%/assistente-ia%")
              ),
            ];
          }
          return [];
        })();

        const filtered = [
          ...base,
          ...(input.unreadOnly ? [eq(megadeskNotifications.isRead, false)] : []),
          ...categoryFilter.filter(Boolean),
        ];

        const [items, totalRows, unreadRows] = await Promise.all([
          db
            .select()
            .from(megadeskNotifications)
            .where(and(...filtered))
            .orderBy(
              desc(megadeskNotifications.createdAt),
              desc(megadeskNotifications.notificationId)
            )
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize),
          db
            .select({ value: count() })
            .from(megadeskNotifications)
            .where(and(...filtered)),
          db
            .select({ value: count() })
            .from(megadeskNotifications)
            .where(and(...base, eq(megadeskNotifications.isRead, false))),
        ]);
        const total = Number(totalRows[0]?.value ?? 0);
        const unreadCount = Number(unreadRows[0]?.value ?? 0);
        return {
          items: items.map(item => ({
            ...item,
            actionUrl: safeActionUrl(item.actionUrl),
          })),
          total,
          unreadCount,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[Notifications] list failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível carregar as notificações.",
        });
      }
    }),

  markAsReadV2: megadeskProcedure
    .input(z.object({ notificationId: z.string().min(1).max(80) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { clientId, userId } = authoritativeIdentity(ctx);
      const scoped = and(
        eq(megadeskNotifications.notificationId, input.notificationId),
        eq(megadeskNotifications.clientId, clientId),
        eq(megadeskNotifications.userId, userId)
      );
      const found = await db
        .select({ notificationId: megadeskNotifications.notificationId })
        .from(megadeskNotifications)
        .where(scoped)
        .limit(1);
      if (!found.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notificação não encontrada",
        });
      await db
        .update(megadeskNotifications)
        .set({
          isRead: true,
          readAt: new Date().toISOString().slice(0, 19).replace("T", " "),
        })
        .where(scoped);
      return { success: true };
    }),

  markAllAsReadV2: megadeskProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const { clientId, userId } = authoritativeIdentity(ctx);
    await db
      .update(megadeskNotifications)
      .set({
        isRead: true,
        readAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      })
      .where(
        and(
          eq(megadeskNotifications.clientId, clientId),
          eq(megadeskNotifications.userId, userId),
          eq(megadeskNotifications.isRead, false)
        )
      );
    return { success: true };
  }),

  deleteReadV2: megadeskProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const { clientId, userId } = authoritativeIdentity(ctx);
    await db
      .delete(megadeskNotifications)
      .where(
        and(
          eq(megadeskNotifications.clientId, clientId),
          eq(megadeskNotifications.userId, userId),
          eq(megadeskNotifications.isRead, true)
        )
      );
    return { success: true };
  }),

  getPreferences: megadeskProcedure.query(async ({ ctx }) => {
    const { clientId, userId } = authoritativeIdentity(ctx);
    const settings = await getUserSettings(clientId, userId);
    return {
      notificationsEnabled: Boolean(settings.notificationsEnabled),
      soundEnabled: Boolean(settings.soundEnabled),
      soundVolume: settings.soundVolume,
      desktopNotificationsEnabled: Boolean(
        settings.desktopNotificationsEnabled
      ),
      whatsappNotificationsEnabled: Boolean(
        settings.whatsappNotificationsEnabled
      ),
      ticketsNotificationsEnabled: Boolean(
        settings.ticketsNotificationsEnabled
      ),
      iaNotificationsEnabled: Boolean(settings.iaNotificationsEnabled),
      erpNotificationsEnabled: Boolean(settings.erpNotificationsEnabled),
      trackingNotificationsEnabled: Boolean(
        settings.trackingNotificationsEnabled
      ),
      showMessagePreview: Boolean(settings.showMessagePreview),
    };
  }),

  updatePreferences: megadeskProcedure
    .input(
      z.object({
        notificationsEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
        soundVolume: z.number().int().min(0).max(100).optional(),
        desktopNotificationsEnabled: z.boolean().optional(),
        whatsappNotificationsEnabled: z.boolean().optional(),
        ticketsNotificationsEnabled: z.boolean().optional(),
        iaNotificationsEnabled: z.boolean().optional(),
        erpNotificationsEnabled: z.boolean().optional(),
        trackingNotificationsEnabled: z.boolean().optional(),
        showMessagePreview: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { clientId, userId } = authoritativeIdentity(ctx);
      const updates: any = {};
      if (input.notificationsEnabled !== undefined)
        updates.notificationsEnabled = input.notificationsEnabled ? 1 : 0;
      if (input.soundEnabled !== undefined)
        updates.soundEnabled = input.soundEnabled ? 1 : 0;
      if (input.soundVolume !== undefined)
        updates.soundVolume = input.soundVolume;
      if (input.desktopNotificationsEnabled !== undefined)
        updates.desktopNotificationsEnabled = input.desktopNotificationsEnabled
          ? 1
          : 0;
      if (input.whatsappNotificationsEnabled !== undefined)
        updates.whatsappNotificationsEnabled = input.whatsappNotificationsEnabled
          ? 1
          : 0;
      if (input.ticketsNotificationsEnabled !== undefined)
        updates.ticketsNotificationsEnabled = input.ticketsNotificationsEnabled
          ? 1
          : 0;
      if (input.iaNotificationsEnabled !== undefined)
        updates.iaNotificationsEnabled = input.iaNotificationsEnabled ? 1 : 0;
      if (input.erpNotificationsEnabled !== undefined)
        updates.erpNotificationsEnabled = input.erpNotificationsEnabled ? 1 : 0;
      if (input.trackingNotificationsEnabled !== undefined)
        updates.trackingNotificationsEnabled =
          input.trackingNotificationsEnabled ? 1 : 0;
      if (input.showMessagePreview !== undefined)
        updates.showMessagePreview = input.showMessagePreview ? 1 : 0;

      await updateUserNotificationSettings(clientId, userId, updates);
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
        if (!userId)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identidade operacional ausente",
          });

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
          notifications: notifications.map(notification => ({
            ...notification,
            createdAt: new Date(notification.createdAt),
            readAt: notification.readAt ? new Date(notification.readAt) : null,
          })),
          total,
          unreadCount: notifications.filter(
            notification => !notification.isRead
          ).length,
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
        if (!userIdStr)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identidade operacional ausente",
          });

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
          .where(
            and(
              eq(megadeskNotifications.notificationId, input.notificationId),
              eq(megadeskNotifications.clientId, ctx.tenantId),
              eq(megadeskNotifications.userId, userIdStr)
            )
          );

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
        if (!userIdStr)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identidade operacional ausente",
          });

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
        type: z
          .enum(["info", "success", "warning", "error", "system"])
          .default("info"),
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
