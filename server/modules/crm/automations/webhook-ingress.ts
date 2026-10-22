import type { Express, Request, Response } from "express";
import { getPool } from "../../../db";
import type { RowDataPacket } from "mysql2";
import { createCrmClient, findDuplicateCrmClient } from "../../../db-crm";
import { dispatchCrmEvent } from "./engine";

export function registerCrmWebhookIngressRoutes(app: Express) {
  app.post("/api/v1/crm/webhooks/:token", async (req: Request, res: Response) => {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token de webhook ausente." });
    }

    const pool = getPool();
    try {
      const [sources] = await pool.query<RowDataPacket[]>(
        `SELECT id, public_id, client_id, name, default_stage_id, field_mappings, is_active
         FROM megadesk_crm_webhook_sources
         WHERE token = ? AND is_active = 1 LIMIT 1`,
        [token]
      );

      if (sources.length === 0) {
        return res.status(404).json({ error: "Webhook inválido ou desativado." });
      }

      const source = sources[0];
      const clientId = source.client_id;
      const mappings =
        typeof source.field_mappings === "string"
          ? JSON.parse(source.field_mappings)
          : source.field_mappings || {};

      const body = req.body || {};

      // Map incoming fields to lead fields
      const name =
        body[mappings.name || "name"] ||
        body.nome ||
        body.nome_completo ||
        body.razao_social ||
        "Lead Webhook";
      const phone =
        body[mappings.phone || "phone"] ||
        body.telefone ||
        body.whatsapp ||
        body.celular ||
        "";
      const email =
        body[mappings.email || "email"] || body.e_mail || body.mail || "";
      const company = body[mappings.company || "company"] || body.empresa || "";
      const notes =
        body[mappings.notes || "notes"] ||
        body.mensagem ||
        body.message ||
        body.observacoes ||
        "";
      const origin =
        body[mappings.origin || "origin"] || body.origem || "site";

      // Increment totalReceived on source
      await pool.execute(
        `UPDATE megadesk_crm_webhook_sources
         SET total_received = total_received + 1, last_received_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [source.id]
      );

      // Check duplicates
      let crmClientId: string;
      const duplicate = phone
        ? await findDuplicateCrmClient(clientId, { phone })
        : null;

      if (duplicate) {
        crmClientId = duplicate.crmClientId;
      } else {
        const created = await createCrmClient(clientId, {
          companyName: name || company || "Novo Lead Webhook",
          customerType: "person",
          responsibleName: name,
          phone,
          whatsapp: phone,
          email,
          status: "lead",
          origin: ["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"].includes(
            origin
          )
            ? (origin as any)
            : "site",
          observations: notes
            ? `[Captura Webhook - ${source.name}]\n${notes}`
            : `Captura via Webhook: ${source.name}`,
        });
        crmClientId = created.crmClientId;
      }

      // Dispatch event lead.created to the automation engine!
      await dispatchCrmEvent(
        clientId,
        "lead.created",
        {
          crm_client_id: crmClientId,
          crmClientId,
          name,
          company_name: name,
          phone,
          whatsapp: phone,
          email,
          origin,
          source_name: source.name,
          message: notes,
          observations: notes,
          raw_payload: body,
        },
        `Webhook: ${source.name}`
      );

      return res.status(200).json({
        success: true,
        crmClientId,
        source: source.name,
      });
    } catch (err: any) {
      console.error("[CRM Webhook Ingress] Erro ao processar payload:", err);
      return res.status(500).json({ error: "Erro interno ao processar webhook." });
    }
  });
}
