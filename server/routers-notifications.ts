import { router, megadeskProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { megadeskNotifications } from "../drizzle/schema";

import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { TRPCError } from "@trpc/server";

// Removed unused userId function

export const notificationsRouter = router({
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
          eq(megadeskNotifications.clientId, input.clientId),
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
          eq(megadeskNotifications.clientId, input.clientId),
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
              eq(megadeskNotifications.clientId, input.clientId),
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
          .update(megadeskNotifications)
          .set({
            isRead: true,
            readAt: new Date().toISOString().slice(0, 19).replace("T", " "),
          })
          .where(and(
            eq(megadeskNotifications.notificationId, input.notificationId),
            eq(megadeskNotifications.clientId, input.clientId),
            eq(megadeskNotifications.userId, userIdStr),
          ));

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error marking notification as read:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao marcar notificação como lida",
        });
      }
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
              eq(megadeskNotifications.clientId, input.clientId),
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
            eq(megadeskNotifications.clientId, input.clientId),
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
          eq(megadeskNotifications.clientId, input.clientId),
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
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const notificationId = uuidv4();
        const userIdStr = ctx.operationalUserId;
        if (!userIdStr) throw new TRPCError({ code: "UNAUTHORIZED", message: "Identidade operacional ausente" });

        await dbInstance.insert(megadeskNotifications).values({
          notificationId,
          clientId: input.clientId,
          userId: userIdStr,
          title: input.title,
          message: input.message,
          type: input.type,
          actionUrl: input.actionUrl ?? null,
          isRead: false,
          createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
        });

        return { notificationId, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error creating notification:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar notificação",
        });
      }
    }),
});
