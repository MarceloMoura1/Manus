import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { megadeskNotifications } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { TRPCError } from "@trpc/server";

const userId = () => {
  // This will be replaced with actual user ID at runtime
  return "user-id";
};

export const notificationsRouter = router({
  // Get all notifications for current user
  getNotifications: protectedProcedure
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
        const userIdStr = String(ctx.user?.id || "");
        
        const whereConditions = [
          eq(megadeskNotifications.clientId, input.clientId),
          eq(megadeskNotifications.userId, userIdStr),
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
          eq(megadeskNotifications.userId, userIdStr),
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
          notifications,
          total,
          unreadCount: notifications.filter((n: any) => !n.isRead).length,
        };
      } catch (error) {
        console.error("Error fetching notifications:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao buscar notificações",
        });
      }
    }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        notificationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userIdStr = String(ctx.user?.id || "");
        
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
            readAt: new Date(),
          })
          .where(eq(megadeskNotifications.notificationId, input.notificationId));

        return { success: true };
      } catch (error) {
        console.error("Error marking notification as read:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao marcar notificação como lida",
        });
      }
    }),

  // Delete notification
  deleteNotification: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        notificationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userIdStr = String(ctx.user?.id || "");
        
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
          .where(eq(megadeskNotifications.notificationId, input.notificationId));

        return { success: true };
      } catch (error) {
        console.error("Error deleting notification:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao deletar notificação",
        });
      }
    }),

  // Mark all as read
  markAllAsRead: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const dbInstance = getDb();
        const userIdStr = String(ctx.user?.id || "");
        
        const updateConditions = [
          eq(megadeskNotifications.clientId, input.clientId),
          eq(megadeskNotifications.userId, userIdStr),
          eq(megadeskNotifications.isRead, false),
        ];

        await dbInstance
          .update(megadeskNotifications)
          .set({
            isRead: true,
            readAt: new Date(),
          })
          .where(and(...updateConditions));

        return { success: true };
      } catch (error) {
        console.error("Error marking all notifications as read:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao marcar todas as notificações como lidas",
        });
      }
    }),

  // Create notification (for testing)
  createNotification: protectedProcedure
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
        const userIdStr = String(ctx.user?.id || "");

        await dbInstance.insert(megadeskNotifications).values({
          notificationId,
          clientId: input.clientId,
          userId: userIdStr,
          title: input.title,
          message: input.message,
          type: input.type,
          actionUrl: input.actionUrl,
          isRead: false,
          createdAt: new Date(),
        });

        return { notificationId, success: true };
      } catch (error) {
        console.error("Error creating notification:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar notificação",
        });
      }
    }),
});
