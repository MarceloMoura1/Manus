import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, megadeskProcedure } from "../../_core/trpc";
import { getActiveClientUser } from "../../db-chamados";
import { isTenantAdminRole } from "../ai-memory/tenant-ai-memory";
import {
  assignMotoboyToOrder,
  createDeliveryOrderForTicket,
  createRestaurantOrderWithTicket,
  ensureRestaurantTicketStatuses,
  getDeliveryOrderByTicket,
  listTenantMotoboys,
  startDeliveryRoute,
  toggleUserMotoboyTag,
  updateDeliveryStage,
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
      return startDeliveryRoute({
        clientId: ctx.tenantId,
        ticketId: input.ticketId,
        actorUserId: actor?.userId || ctx.operationalUserId,
        actorUserName: actor?.userName || ctx.userEmail || "Motoboy",
      });
    }),

  listMotoboys: megadeskProcedure.query(async ({ ctx }) => {
    return listTenantMotoboys(ctx.tenantId);
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

