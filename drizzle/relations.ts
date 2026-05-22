import { relations } from "drizzle-orm/relations";
import { instance, chat, chatwoot, contact, dify, difySetting, evoai, evoaiSetting, evolutionBot, evolutionBotSetting, flowise, flowiseSetting, integrationSession, kafka, label, message, media, messageUpdate, n8N, n8NSetting, nats, openaiCreds, openaiBot, openaiSetting, proxy, pusher, rabbitmq, session, setting, sqs, template, typebot, typebotSetting, webhook, websocket } from "./schema";

export const chatRelations = relations(chat, ({one}) => ({
	instance: one(instance, {
		fields: [chat.instanceId],
		references: [instance.id]
	}),
}));

export const instanceRelations = relations(instance, ({many}) => ({
	chats: many(chat),
	chatwoots: many(chatwoot),
	contacts: many(contact),
	difies: many(dify),
	difySettings: many(difySetting),
	evoais: many(evoai),
	evoaiSettings: many(evoaiSetting),
	evolutionBots: many(evolutionBot),
	evolutionBotSettings: many(evolutionBotSetting),
	flowises: many(flowise),
	flowiseSettings: many(flowiseSetting),
	integrationSessions: many(integrationSession),
	kafkas: many(kafka),
	labels: many(label),
	media: many(media),
	messages: many(message),
	messageUpdates: many(messageUpdate),
	n8NS: many(n8N),
	n8NSettings: many(n8NSetting),
	nats: many(nats),
	openaiBots: many(openaiBot),
	openaiCreds: many(openaiCreds),
	openaiSettings: many(openaiSetting),
	proxies: many(proxy),
	pushers: many(pusher),
	rabbitmqs: many(rabbitmq),
	sessions: many(session),
	settings: many(setting),
	sqs: many(sqs),
	templates: many(template),
	typebots: many(typebot),
	typebotSettings: many(typebotSetting),
	webhooks: many(webhook),
	websockets: many(websocket),
}));

export const chatwootRelations = relations(chatwoot, ({one}) => ({
	instance: one(instance, {
		fields: [chatwoot.instanceId],
		references: [instance.id]
	}),
}));

export const contactRelations = relations(contact, ({one}) => ({
	instance: one(instance, {
		fields: [contact.instanceId],
		references: [instance.id]
	}),
}));

export const difyRelations = relations(dify, ({one, many}) => ({
	instance: one(instance, {
		fields: [dify.instanceId],
		references: [instance.id]
	}),
	difySettings: many(difySetting),
}));

export const difySettingRelations = relations(difySetting, ({one}) => ({
	dify: one(dify, {
		fields: [difySetting.difyIdFallback],
		references: [dify.id]
	}),
	instance: one(instance, {
		fields: [difySetting.instanceId],
		references: [instance.id]
	}),
}));

export const evoaiRelations = relations(evoai, ({one, many}) => ({
	instance: one(instance, {
		fields: [evoai.instanceId],
		references: [instance.id]
	}),
	evoaiSettings: many(evoaiSetting),
}));

export const evoaiSettingRelations = relations(evoaiSetting, ({one}) => ({
	evoai: one(evoai, {
		fields: [evoaiSetting.evoaiIdFallback],
		references: [evoai.id]
	}),
	instance: one(instance, {
		fields: [evoaiSetting.instanceId],
		references: [instance.id]
	}),
}));

export const evolutionBotRelations = relations(evolutionBot, ({one, many}) => ({
	instance: one(instance, {
		fields: [evolutionBot.instanceId],
		references: [instance.id]
	}),
	evolutionBotSettings: many(evolutionBotSetting),
}));

export const evolutionBotSettingRelations = relations(evolutionBotSetting, ({one}) => ({
	evolutionBot: one(evolutionBot, {
		fields: [evolutionBotSetting.botIdFallback],
		references: [evolutionBot.id]
	}),
	instance: one(instance, {
		fields: [evolutionBotSetting.instanceId],
		references: [instance.id]
	}),
}));

export const flowiseRelations = relations(flowise, ({one, many}) => ({
	instance: one(instance, {
		fields: [flowise.instanceId],
		references: [instance.id]
	}),
	flowiseSettings: many(flowiseSetting),
}));

export const flowiseSettingRelations = relations(flowiseSetting, ({one}) => ({
	flowise: one(flowise, {
		fields: [flowiseSetting.flowiseIdFallback],
		references: [flowise.id]
	}),
	instance: one(instance, {
		fields: [flowiseSetting.instanceId],
		references: [instance.id]
	}),
}));

export const integrationSessionRelations = relations(integrationSession, ({one, many}) => ({
	instance: one(instance, {
		fields: [integrationSession.instanceId],
		references: [instance.id]
	}),
	messages: many(message),
}));

export const kafkaRelations = relations(kafka, ({one}) => ({
	instance: one(instance, {
		fields: [kafka.instanceId],
		references: [instance.id]
	}),
}));

export const labelRelations = relations(label, ({one}) => ({
	instance: one(instance, {
		fields: [label.instanceId],
		references: [instance.id]
	}),
}));

export const mediaRelations = relations(media, ({one}) => ({
	message: one(message, {
		fields: [media.messageId],
		references: [message.id]
	}),
	instance: one(instance, {
		fields: [media.instanceId],
		references: [instance.id]
	}),
}));

export const messageRelations = relations(message, ({one, many}) => ({
	media: many(media),
	instance: one(instance, {
		fields: [message.instanceId],
		references: [instance.id]
	}),
	integrationSession: one(integrationSession, {
		fields: [message.sessionId],
		references: [integrationSession.id]
	}),
	messageUpdates: many(messageUpdate),
}));

export const messageUpdateRelations = relations(messageUpdate, ({one}) => ({
	message: one(message, {
		fields: [messageUpdate.messageId],
		references: [message.id]
	}),
	instance: one(instance, {
		fields: [messageUpdate.instanceId],
		references: [instance.id]
	}),
}));

export const n8NRelations = relations(n8N, ({one, many}) => ({
	instance: one(instance, {
		fields: [n8N.instanceId],
		references: [instance.id]
	}),
	n8NSettings: many(n8NSetting),
}));

export const n8NSettingRelations = relations(n8NSetting, ({one}) => ({
	n8N: one(n8N, {
		fields: [n8NSetting.n8NIdFallback],
		references: [n8N.id]
	}),
	instance: one(instance, {
		fields: [n8NSetting.instanceId],
		references: [instance.id]
	}),
}));

export const natsRelations = relations(nats, ({one}) => ({
	instance: one(instance, {
		fields: [nats.instanceId],
		references: [instance.id]
	}),
}));

export const openaiBotRelations = relations(openaiBot, ({one, many}) => ({
	openaiCred: one(openaiCreds, {
		fields: [openaiBot.openaiCredsId],
		references: [openaiCreds.id]
	}),
	instance: one(instance, {
		fields: [openaiBot.instanceId],
		references: [instance.id]
	}),
	openaiSettings: many(openaiSetting),
}));

export const openaiCredsRelations = relations(openaiCreds, ({one, many}) => ({
	openaiBots: many(openaiBot),
	instance: one(instance, {
		fields: [openaiCreds.instanceId],
		references: [instance.id]
	}),
	openaiSettings: many(openaiSetting),
}));

export const openaiSettingRelations = relations(openaiSetting, ({one}) => ({
	openaiCred: one(openaiCreds, {
		fields: [openaiSetting.openaiCredsId],
		references: [openaiCreds.id]
	}),
	openaiBot: one(openaiBot, {
		fields: [openaiSetting.openaiIdFallback],
		references: [openaiBot.id]
	}),
	instance: one(instance, {
		fields: [openaiSetting.instanceId],
		references: [instance.id]
	}),
}));

export const proxyRelations = relations(proxy, ({one}) => ({
	instance: one(instance, {
		fields: [proxy.instanceId],
		references: [instance.id]
	}),
}));

export const pusherRelations = relations(pusher, ({one}) => ({
	instance: one(instance, {
		fields: [pusher.instanceId],
		references: [instance.id]
	}),
}));

export const rabbitmqRelations = relations(rabbitmq, ({one}) => ({
	instance: one(instance, {
		fields: [rabbitmq.instanceId],
		references: [instance.id]
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	instance: one(instance, {
		fields: [session.sessionId],
		references: [instance.id]
	}),
}));

export const settingRelations = relations(setting, ({one}) => ({
	instance: one(instance, {
		fields: [setting.instanceId],
		references: [instance.id]
	}),
}));

export const sqsRelations = relations(sqs, ({one}) => ({
	instance: one(instance, {
		fields: [sqs.instanceId],
		references: [instance.id]
	}),
}));

export const templateRelations = relations(template, ({one}) => ({
	instance: one(instance, {
		fields: [template.instanceId],
		references: [instance.id]
	}),
}));

export const typebotRelations = relations(typebot, ({one, many}) => ({
	instance: one(instance, {
		fields: [typebot.instanceId],
		references: [instance.id]
	}),
	typebotSettings: many(typebotSetting),
}));

export const typebotSettingRelations = relations(typebotSetting, ({one}) => ({
	typebot: one(typebot, {
		fields: [typebotSetting.typebotIdFallback],
		references: [typebot.id]
	}),
	instance: one(instance, {
		fields: [typebotSetting.instanceId],
		references: [instance.id]
	}),
}));

export const webhookRelations = relations(webhook, ({one}) => ({
	instance: one(instance, {
		fields: [webhook.instanceId],
		references: [instance.id]
	}),
}));

export const websocketRelations = relations(websocket, ({one}) => ({
	instance: one(instance, {
		fields: [websocket.instanceId],
		references: [instance.id]
	}),
}));