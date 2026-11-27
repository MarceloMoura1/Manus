import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, megadeskProcedure } from "../../_core/trpc";
import { getActiveClientUser } from "../../db-chamados";
import { isTenantAdminRole } from "../ai-memory/tenant-ai-memory";
import {
  assertMotoboyOrAdmin,
  assignMotoboyToOrder,
  completeDeliveryOrder,
  createDeliveryOrderForTicket,
  createRestaurantOrderWithTicket,
  ensureRestaurantTicketStatuses,
  getDeliveryLiveOverview,
  getDeliveryOrderByTicket,
  getDeliveryPayoutReport,
  getMotoboyHistory,
  getMotoboyQueue,
  listTenantMotoboys,
  startDeliveryRoute,
  toggleUserMotoboyTag,
  updateDeliveryStage,
  updateMotoboyLocation,
} from "./delivery.service";

const orderSourceSchema = z.enum(["site", "whatsapp", "manual"]);
const addressTypeSchema = z.enum(["casa", "apartamento", "comercial", "outro"]);
const stageLabelSchema = z.enum([
  "Novo Pedido",
  "Em Preparo",
  "Pronto p/ Motoboy",
  "Em Rota com Motoboy",
  "Entregue",
]);
const historyPeriodSchema = z.enum(["today", "week", "month", "custom"]);

export const deliveryRouter = router({
  getStatuses: megadeskProcedure.query(async ({ ctx }) => {
    const statuses = await ensureRestaurantTicketStatuses(ctx.tenantId);
    return { statuses };
  }),

  getByTicket: megadeskProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const order = await getDeliveryOrderByTicket(ctx.tenantId, input.ticketId);
      return { order };
    }),

  createOrder: megadeskProcedure
    .input(
      z.object({
        customerId: z.string().min(1).max(80),
        customerName: z.string().min(1).max(180),
        customerPhone: z.string().min(4).max(40),
        company: z.string().max(180).optional(),
        title: z.string().max(200).optional(),
        observations: z.string().max(2000).optional(),
        priority: z.enum(["baixa", "media", "alta", "critica"]).default("media"),
        orderSource: orderSourceSchema.default("manual"),
        itemsSummary: z.string().min(1).max(4000),
        orderTotal: z.number().min(0),
        deliveryFee: z.number().min(0).default(0),
        paymentMethod: z.string().min(1).max(80).default("A combinar"),
        deliveryAddress: z.string().min(3).max(1000),
        addressType: addressTypeSchema.default("casa"),
        addressComplement: z.string().max(255).nullable().optional(),
        destinationLat: z.number().nullable().optional(),
        destinationLng: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const actor = (await getActiveClientUser(ctx.tenantId, ctx.operationalUserId ?? "")) ?? {
        userId: ctx.operationalUserId || ctx.userEmail || "system",
        userName: ctx.userEmail || "Operador",
      };
      return createRestaurantOrderWithTicket({
        ...input,
        clientId: ctx.tenantId,
        actor,
      });
    }),

  upsertForTicket: megadeskProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        orderSource: orderSourceSchema.default("manual"),
        itemsSummary: z.string().max(4000).default(""),
        orderTotal: z.number().min(0).default(0),
        deliveryFee: z.number().min(0).default(0),
        paymentMethod: z.string().min(1).max(80).default("A combinar"),
        customerName: z.string().min(1).max(180),
        customerPhone: z.string().min(4).max(40),
        deliveryAddress: z.string().min(3).max(1000),
        addressType: addressTypeSchema.default("casa"),
        addressComplement: z.string().max(255).nullable().optional(),
        destinationLat: z.number().nullable().optional(),
        destinationLng: z.number().nullable().optional(),
        motoboyUserId: z.string().max(128).nullable().optional(),
        routeSequence: z.number().int().min(1).default(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getDeliveryOrderByTicket(ctx.tenantId, input.ticketId);
      if (existing) {
        return {
          order: await assignMotoboyToOrder({
            clientId: ctx.tenantId,
            ticketId: input.ticketId,
            motoboyUserId: input.motoboyUserId ?? existing.motoboyUserId,
            routeSequence: input.routeSequence,
            deliveryFee: input.deliveryFee,
          }),
        };
      }
      const order = await createDeliveryOrderForTicket({
        ...input,
        clientId: ctx.tenantId,
      });
      return { order };
    }),

  assignMotoboy: megadeskProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        motoboyUserId: z.string().max(128).nullable(),
        routeSequence: z.number().int().min(1).optional(),
        deliveryFee: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const order = await assignMotoboyToOrder({
        clientId: ctx.tenantId,
        ticketId: input.ticketId,
        motoboyUserId: input.motoboyUserId,
        routeSequence: input.routeSequence,
        deliveryFee: input.deliveryFee,
      });
      return { ok: true, order };
    }),

  updateStage: megadeskProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        stageLabel: stageLabelSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const order = await updateDeliveryStage({
        clientId: ctx.tenantId,
        ticketId: input.ticketId,
        stageLabel: input.stageLabel,
      });
      return { ok: true, order };
    }),

  startRoute: megadeskProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const actor = await getActiveClientUser(ctx.tenantId, ctx.operationalUserId ?? "");
      const isAdmin = isTenantAdminRole(ctx.operationalUserRole) || isTenantAdminRole(ctx.user?.role);
      return startDeliveryRoute({
        clientId: ctx.tenantId,
        ticketId: input.ticketId,
        actorUserId: actor?.userId || ctx.operationalUserId,
        actorUserName: actor?.userName || ctx.userEmail || "Motoboy",
        isAdmin,
      });
    }),

  myQueue: megadeskProcedure.query(async ({ ctx }) => {
    const auth = await assertMotoboyOrAdmin({
      clientId: ctx.tenantId,
      userId: ctx.operationalUserId,
      role: ctx.operationalUserRole || ctx.user?.role,
      permissions: ctx.operationalPermissions,
    });
    const orders = await getMotoboyQueue({
      clientId: ctx.tenantId,
      motoboyUserId: auth.userId,
    });
    return { orders };
  }),

  myHistory: megadeskProcedure
    .input(
      z
        .object({
          period: historyPeriodSchema.default("today"),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .default({ period: "today" })
    )
    .query(async ({ input, ctx }) => {
      const auth = await assertMotoboyOrAdmin({
        clientId: ctx.tenantId,
        userId: ctx.operationalUserId,
        role: ctx.operationalUserRole || ctx.user?.role,
        permissions: ctx.operationalPermissions,
      });
      return getMotoboyHistory({
        clientId: ctx.tenantId,
        motoboyUserId: auth.userId,
        period: input.period,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  updateMotoboyLocation: megadeskProcedure
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        speed: z.number().nullable().optional(),
        heading: z.number().nullable().optional(),
        activeOrderId: z.string().max(64).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const auth = await assertMotoboyOrAdmin({
        clientId: ctx.tenantId,
        userId: ctx.operationalUserId,
        role: ctx.operationalUserRole || ctx.user?.role,
        permissions: ctx.operationalPermissions,
      });
      return updateMotoboyLocation({
        clientId: ctx.tenantId,
        motoboyUserId: auth.userId,
        lat: input.lat,
        lng: input.lng,
        speed: input.speed ?? null,
        heading: input.heading ?? null,
        activeOrderId: input.activeOrderId ?? null,
      });
    }),

  completeDelivery: megadeskProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        deliveryCode: z.string().min(4).max(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const auth = await assertMotoboyOrAdmin({
        clientId: ctx.tenantId,
        userId: ctx.operationalUserId,
        role: ctx.operationalUserRole || ctx.user?.role,
        permissions: ctx.operationalPermissions,
      });
      const actor = await getActiveClientUser(ctx.tenantId, auth.userId);
      return completeDeliveryOrder({
        clientId: ctx.tenantId,
        ticketId: input.ticketId,
        deliveryCode: input.deliveryCode,
        motoboyUserId: auth.userId,
        isAdmin: auth.isAdmin,
        actorUserName: actor?.userName || ctx.userEmail || "Motoboy",
      });
    }),

  listMotoboys: megadeskProcedure.query(async ({ ctx }) => {
    return listTenantMotoboys(ctx.tenantId);
  }),

  liveOverview: megadeskProcedure.query(async ({ ctx }) => {
    return getDeliveryLiveOverview(ctx.tenantId);
  }),

  payoutReport: megadeskProcedure
    .input(
      z
        .object({
          motoboyUserId: z.string().optional(),
          preset: historyPeriodSchema.default("today"),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .default({ preset: "today" })
    )
    .query(async ({ input, ctx }) => {
      return getDeliveryPayoutReport({
        clientId: ctx.tenantId,
        motoboyUserId: input.motoboyUserId,
        preset: input.preset,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  toggleMotoboyTag: megadeskProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isTenantAdminRole(ctx.operationalUserRole) && !isTenantAdminRole(ctx.user?.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem marcar usuários como motoboy.",
        });
      }
      return toggleUserMotoboyTag({
        clientId: ctx.tenantId,
        userId: input.userId,
        enabled: input.enabled,
      });
    }),
});
