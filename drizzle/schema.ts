import { mysqlTable, mysqlSchema, AnyMySqlColumn, index, foreignKey, varchar, json, timestamp, int, mysqlEnum, text, datetime, longtext, date, bigint, tinyint } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

export const chat = mysqlTable("Chat", {
	id: varchar({ length: 191 }).notNull(),
	remoteJid: varchar({ length: 100 }).notNull(),
	labels: json(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	name: varchar({ length: 100 }),
	unreadMessages: int().default(0).notNull(),
},
(table) => [
	index("Chat_instanceId_idx").on(table.instanceId),
	index("Chat_remoteJid_idx").on(table.remoteJid),
	index("Chat_instanceId_remoteJid_key").on(table.instanceId, table.remoteJid),
]);

export const chatwoot = mysqlTable("Chatwoot", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1),
	accountId: varchar({ length: 100 }),
	token: varchar({ length: 100 }),
	url: varchar({ length: 500 }),
	nameInbox: varchar({ length: 100 }),
	signMsg: tinyint().default(0),
	signDelimiter: varchar({ length: 100 }),
	number: varchar({ length: 100 }),
	reopenConversation: tinyint().default(0),
	conversationPending: tinyint().default(0),
	mergeBrazilContacts: tinyint().default(0),
	importContacts: tinyint().default(0),
	importMessages: tinyint().default(0),
	daysLimitImportMessages: int(),
	organization: varchar({ length: 100 }),
	logo: varchar({ length: 500 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	ignoreJids: json(),
},
(table) => [
	index("Chatwoot_instanceId_key").on(table.instanceId),
]);

export const contact = mysqlTable("Contact", {
	id: varchar({ length: 191 }).notNull(),
	remoteJid: varchar({ length: 100 }).notNull(),
	pushName: varchar({ length: 100 }),
	profilePicUrl: varchar({ length: 500 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Contact_instanceId_idx").on(table.instanceId),
	index("Contact_remoteJid_instanceId_key").on(table.remoteJid, table.instanceId),
	index("Contact_remoteJid_idx").on(table.remoteJid),
]);

export const dify = mysqlTable("Dify", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	botType: mysqlEnum(['chatBot','textGenerator','agent','workflow']).notNull(),
	apiUrl: varchar({ length: 255 }),
	apiKey: varchar({ length: 255 }),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
});

export const difySetting = mysqlTable("DifySetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	difyIdFallback: varchar({ length: 100 }).references(() => dify.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
},
(table) => [
	index("DifySetting_instanceId_key").on(table.instanceId),
]);

export const evoai = mysqlTable("Evoai", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	agentUrl: varchar({ length: 255 }),
	apiKey: varchar({ length: 255 }),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
});

export const evoaiSetting = mysqlTable("EvoaiSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	evoaiIdFallback: varchar({ length: 100 }).references(() => evoai.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("EvoaiSetting_instanceId_key").on(table.instanceId),
]);

export const evolutionBot = mysqlTable("EvolutionBot", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	apiUrl: varchar({ length: 255 }),
	apiKey: varchar({ length: 255 }),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
});

export const evolutionBotSetting = mysqlTable("EvolutionBotSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	botIdFallback: varchar({ length: 100 }).references(() => evolutionBot.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
},
(table) => [
	index("EvolutionBotSetting_instanceId_key").on(table.instanceId),
]);

export const flowise = mysqlTable("Flowise", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	apiUrl: varchar({ length: 255 }),
	apiKey: varchar({ length: 255 }),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
});

export const flowiseSetting = mysqlTable("FlowiseSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	flowiseIdFallback: varchar({ length: 100 }).references(() => flowise.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
},
(table) => [
	index("FlowiseSetting_instanceId_key").on(table.instanceId),
]);

export const instance = mysqlTable("Instance", {
	id: varchar({ length: 191 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	connectionStatus: mysqlEnum(['open','close','connecting']).default('open').notNull(),
	ownerJid: varchar({ length: 100 }),
	profileName: varchar({ length: 100 }),
	profilePicUrl: varchar({ length: 500 }),
	integration: varchar({ length: 100 }),
	number: varchar({ length: 100 }),
	businessId: varchar({ length: 100 }),
	token: varchar({ length: 255 }),
	clientName: varchar({ length: 100 }),
	disconnectionReasonCode: int(),
	disconnectionObject: json(),
	disconnectionAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }),
},
(table) => [
	index("Instance_name_key").on(table.name),
]);

export const integrationSession = mysqlTable("IntegrationSession", {
	id: varchar({ length: 191 }).notNull(),
	sessionId: varchar({ length: 255 }).notNull(),
	remoteJid: varchar({ length: 100 }).notNull(),
	pushName: varchar({ length: 191 }),
	status: mysqlEnum(['opened','closed','paused']).notNull(),
	awaitUser: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	parameters: json(),
	botId: varchar({ length: 191 }),
	context: json(),
	type: varchar({ length: 100 }),
});

export const isOnWhatsapp = mysqlTable("IsOnWhatsapp", {
	id: varchar({ length: 191 }).notNull(),
	remoteJid: varchar({ length: 100 }).notNull(),
	jidOptions: varchar({ length: 191 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
},
(table) => [
	index("IsOnWhatsapp_remoteJid_key").on(table.remoteJid),
]);

export const kafka = mysqlTable("Kafka", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Kafka_instanceId_key").on(table.instanceId),
]);

export const label = mysqlTable("Label", {
	id: varchar({ length: 191 }).notNull(),
	labelId: varchar({ length: 100 }),
	name: varchar({ length: 100 }).notNull(),
	color: varchar({ length: 100 }).notNull(),
	predefinedId: varchar({ length: 100 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
});

export const media = mysqlTable("Media", {
	id: varchar({ length: 191 }).notNull(),
	fileName: varchar({ length: 500 }).notNull(),
	type: varchar({ length: 100 }).notNull(),
	mimetype: varchar({ length: 100 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	messageId: varchar({ length: 191 }).notNull().references(() => message.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Media_messageId_key").on(table.messageId),
]);

export const message = mysqlTable("Message", {
	id: varchar({ length: 191 }).notNull(),
	key: json().notNull(),
	pushName: varchar({ length: 100 }),
	participant: varchar({ length: 100 }),
	messageType: varchar({ length: 100 }).notNull(),
	message: json().notNull(),
	contextInfo: json(),
	source: mysqlEnum(['ios','android','web','unknown','desktop']).notNull(),
	messageTimestamp: int().notNull(),
	chatwootMessageId: int(),
	chatwootInboxId: int(),
	chatwootConversationId: int(),
	chatwootContactInboxSourceId: varchar({ length: 100 }),
	chatwootIsRead: tinyint().default(0),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	typebotSessionId: varchar({ length: 191 }),
	webhookUrl: varchar({ length: 500 }),
	sessionId: varchar({ length: 191 }).references(() => integrationSession.id, { onDelete: "set null", onUpdate: "cascade" } ),
	status: varchar({ length: 30 }),
},
(table) => [
	index("Message_instanceId_idx").on(table.instanceId),
]);

export const messageUpdate = mysqlTable("MessageUpdate", {
	id: varchar({ length: 191 }).notNull(),
	keyId: varchar({ length: 100 }).notNull(),
	remoteJid: varchar({ length: 100 }).notNull(),
	fromMe: tinyint().notNull(),
	participant: varchar({ length: 100 }),
	pollUpdates: json(),
	status: varchar({ length: 30 }).notNull(),
	messageId: varchar({ length: 191 }).notNull().references(() => message.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("MessageUpdate_messageId_idx").on(table.messageId),
	index("MessageUpdate_instanceId_idx").on(table.instanceId),
]);

export const n8N = mysqlTable("N8n", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	webhookUrl: varchar({ length: 255 }),
	basicAuthUser: varchar({ length: 255 }),
	basicAuthPass: varchar({ length: 255 }),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
});

export const n8NSetting = mysqlTable("N8nSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	n8NIdFallback: varchar({ length: 100 }).references(() => n8N.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("N8nSetting_instanceId_key").on(table.instanceId),
]);

export const nats = mysqlTable("Nats", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Nats_instanceId_key").on(table.instanceId),
]);

export const openaiBot = mysqlTable("OpenaiBot", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	botType: mysqlEnum(['assistant','chatCompletion']).notNull(),
	assistantId: varchar({ length: 255 }),
	functionUrl: varchar({ length: 500 }),
	model: varchar({ length: 100 }),
	systemMessages: json(),
	assistantMessages: json(),
	userMessages: json(),
	maxTokens: int(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	openaiCredsId: varchar({ length: 191 }).notNull().references(() => openaiCreds.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
});

export const openaiCreds = mysqlTable("OpenaiCreds", {
	id: varchar({ length: 191 }).notNull(),
	name: varchar({ length: 255 }),
	apiKey: varchar({ length: 255 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("OpenaiCreds_name_key").on(table.name),
	index("OpenaiCreds_apiKey_key").on(table.apiKey),
]);

export const openaiSetting = mysqlTable("OpenaiSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	ignoreJids: json(),
	speechToText: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	openaiCredsId: varchar({ length: 191 }).notNull().references(() => openaiCreds.id, { onDelete: "restrict", onUpdate: "cascade" } ),
	openaiIdFallback: varchar({ length: 100 }).references(() => openaiBot.id, { onDelete: "set null", onUpdate: "cascade" } ),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	splitMessages: tinyint().default(0),
	timePerChar: int().default(50),
},
(table) => [
	index("OpenaiSetting_openaiCredsId_key").on(table.openaiCredsId),
	index("OpenaiSetting_instanceId_key").on(table.instanceId),
]);

export const proxy = mysqlTable("Proxy", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	host: varchar({ length: 100 }).notNull(),
	port: varchar({ length: 100 }).notNull(),
	protocol: varchar({ length: 100 }).notNull(),
	username: varchar({ length: 100 }).notNull(),
	password: varchar({ length: 100 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Proxy_instanceId_key").on(table.instanceId),
]);

export const pusher = mysqlTable("Pusher", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	appId: varchar({ length: 100 }).notNull(),
	key: varchar({ length: 100 }).notNull(),
	secret: varchar({ length: 100 }).notNull(),
	cluster: varchar({ length: 100 }).notNull(),
	useTls: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Pusher_instanceId_key").on(table.instanceId),
]);

export const rabbitmq = mysqlTable("Rabbitmq", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Rabbitmq_instanceId_key").on(table.instanceId),
]);

export const session = mysqlTable("Session", {
	id: varchar({ length: 191 }).notNull(),
	sessionId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	creds: text(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("Session_sessionId_key").on(table.sessionId),
]);

export const setting = mysqlTable("Setting", {
	id: varchar({ length: 191 }).notNull(),
	rejectCall: tinyint().default(0).notNull(),
	msgCall: varchar({ length: 100 }),
	groupsIgnore: tinyint().default(0).notNull(),
	alwaysOnline: tinyint().default(0).notNull(),
	readMessages: tinyint().default(0).notNull(),
	readStatus: tinyint().default(0).notNull(),
	syncFullHistory: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	wavoipToken: varchar({ length: 100 }),
},
(table) => [
	index("Setting_instanceId_key").on(table.instanceId),
	index("Setting_instanceId_idx").on(table.instanceId),
]);

export const sqs = mysqlTable("Sqs", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Sqs_instanceId_key").on(table.instanceId),
]);

export const template = mysqlTable("Template", {
	id: varchar({ length: 191 }).notNull(),
	templateId: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	template: json().notNull(),
	webhookUrl: varchar({ length: 500 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Template_templateId_key").on(table.templateId),
	index("Template_name_key").on(table.name),
]);

export const typebot = mysqlTable("Typebot", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	description: varchar({ length: 255 }),
	url: varchar({ length: 500 }).notNull(),
	typebot: varchar({ length: 100 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }),
	ignoreJids: json(),
	triggerType: mysqlEnum(['all','keyword','none','advanced']),
	triggerOperator: mysqlEnum(['contains','equals','startsWith','endsWith','regex']),
	triggerValue: varchar({ length: 191 }),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
});

export const typebotSetting = mysqlTable("TypebotSetting", {
	id: varchar({ length: 191 }).notNull(),
	expire: int().default(0),
	keywordFinish: varchar({ length: 100 }),
	delayMessage: int(),
	unknownMessage: varchar({ length: 100 }),
	listeningFromMe: tinyint().default(0),
	stopBotFromMe: tinyint().default(0),
	keepOpen: tinyint().default(0),
	debounceTime: int(),
	typebotIdFallback: varchar({ length: 100 }).references(() => typebot.id, { onDelete: "set null", onUpdate: "cascade" } ),
	ignoreJids: json(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("TypebotSetting_instanceId_key").on(table.instanceId),
]);

export const webhook = mysqlTable("Webhook", {
	id: varchar({ length: 191 }).notNull(),
	url: varchar({ length: 500 }).notNull(),
	enabled: tinyint().default(1),
	events: json(),
	webhookByEvents: tinyint().default(0),
	webhookBase64: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	headers: json(),
},
(table) => [
	index("Webhook_instanceId_key").on(table.instanceId),
	index("Webhook_instanceId_idx").on(table.instanceId),
]);

export const websocket = mysqlTable("Websocket", {
	id: varchar({ length: 191 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	events: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	instanceId: varchar({ length: 191 }).notNull().references(() => instance.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	index("Websocket_instanceId_key").on(table.instanceId),
]);

export const prismaMigrations = mysqlTable("_prisma_migrations", {
	id: varchar({ length: 36 }).notNull(),
	checksum: varchar({ length: 64 }).notNull(),
	finishedAt: datetime("finished_at", { mode: 'string', fsp: 3 }),
	migrationName: varchar("migration_name", { length: 255 }).notNull(),
	logs: text(),
	rolledBackAt: datetime("rolled_back_at", { mode: 'string', fsp: 3 }),
	startedAt: datetime("started_at", { mode: 'string', fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
	appliedStepsCount: int("applied_steps_count", { unsigned: true }).default(0).notNull(),
});

export const baileysAuthState = mysqlTable("baileys_auth_state", {
	clientId: varchar("client_id", { length: 255 }).notNull(),
	authKey: varchar("auth_key", { length: 255 }).notNull(),
	authValue: longtext("auth_value").notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
});

export const evolutionFailedMessages = mysqlTable("evolution_failed_messages", {
	failedMessageId: varchar("failed_message_id", { length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	conversationId: varchar("conversation_id", { length: 255 }).notNull(),
	messageId: varchar("message_id", { length: 255 }),
	phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
	messageText: text("message_text").notNull(),
	agentName: varchar("agent_name", { length: 255 }),
	status: mysqlEnum(['pending','retrying','sent','failed_permanent']).default('pending').notNull(),
	retryCount: int("retry_count").default(0).notNull(),
	maxRetries: int("max_retries").default(3).notNull(),
	lastError: text("last_error"),
	errorCode: varchar("error_code", { length: 50 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	nextRetryAt: timestamp("next_retry_at", { mode: 'string' }),
	sentAt: timestamp("sent_at", { mode: 'string' }),
},
(table) => [
	index("evolution_failed_messages_client_id_idx").on(table.clientId),
	index("evolution_failed_messages_status_idx").on(table.status),
	index("evolution_failed_messages_next_retry_idx").on(table.nextRetryAt),
	index("evolution_failed_messages_client_status_idx").on(table.clientId, table.status),
]);

export const evolutionQueueConfig = mysqlTable("evolution_queue_config", {
	configId: varchar("config_id", { length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	maxRetries: int("max_retries").default(3).notNull(),
	retryDelayMs: int("retry_delay_ms").default(1000).notNull(),
	backoffMultiplier: int("backoff_multiplier").default(2).notNull(),
	maxBackoffMs: int("max_backoff_ms").default(60000).notNull(),
	autoRetryEnabled: int("auto_retry_enabled").default(1).notNull(),
	cleanupAfterDaysSuccess: int("cleanup_after_days_success").default(7).notNull(),
	cleanupAfterDaysFailed: int("cleanup_after_days_failed").default(30).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("evolution_queue_config_client_id_unique").on(table.clientId),
	index("evolution_queue_config_client_id_idx").on(table.clientId),
]);

export const evolutionQueueMetrics = mysqlTable("evolution_queue_metrics", {
	metricsId: varchar("metrics_id", { length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	date: timestamp({ mode: 'string' }).notNull(),
	totalFailed: int("total_failed").default(0).notNull(),
	totalRetried: int("total_retried").default(0).notNull(),
	totalSucceeded: int("total_succeeded").default(0).notNull(),
	totalPermanentFailed: int("total_permanent_failed").default(0).notNull(),
	avgRetryCount: int("avg_retry_count").default(0).notNull(),
	avgResponseTimeMs: int("avg_response_time_ms").default(0).notNull(),
	successRate: int("success_rate").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("evolution_queue_metrics_client_id_idx").on(table.clientId),
	index("evolution_queue_metrics_date_idx").on(table.date),
	index("evolution_queue_metrics_client_date_idx").on(table.clientId, table.date),
]);

export const evolutionRetryHistory = mysqlTable("evolution_retry_history", {
	retryHistoryId: varchar("retry_history_id", { length: 255 }).notNull(),
	failedMessageId: varchar("failed_message_id", { length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 255 }).notNull(),
	retryNumber: int("retry_number").notNull(),
	status: mysqlEnum(['success','failed']).default('failed').notNull(),
	error: text(),
	errorCode: varchar("error_code", { length: 50 }),
	attemptedAt: timestamp("attempted_at", { mode: 'string' }).defaultNow().notNull(),
	responseTime: int("response_time"),
},
(table) => [
	index("evolution_retry_history_failed_message_id_idx").on(table.failedMessageId),
	index("evolution_retry_history_client_id_idx").on(table.clientId),
	index("evolution_retry_history_status_idx").on(table.status),
]);

export const megadeskCompanySettings = mysqlTable("megadesk_company_settings", {
	settingId: varchar("setting_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	companyName: varchar("company_name", { length: 255 }),
	logoUrl: text("logo_url"),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	whatsapp: varchar({ length: 20 }),
	address: text(),
	businessHours: text("business_hours"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("uq_client_settings").on(table.clientId),
]);

export const megadeskDomainAuditLogs = mysqlTable("megadesk_domain_audit_logs", {
	auditId: varchar("audit_id", { length: 100 }).notNull(),
	platform: mysqlEnum(['MegaAdmin','MegaDesk']).notNull(),
	action: varchar({ length: 255 }).notNull(),
	clientId: varchar("client_id", { length: 80 }),
	success: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdal_client").on(table.clientId),
]);

export const megadeskDomainBackups = mysqlTable("megadesk_domain_backups", {
	backupId: varchar("backup_id", { length: 80 }).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	backupDate: date("backup_date", { mode: 'string' }).notNull(),
	backupTimestamp: timestamp("backup_timestamp", { mode: 'string' }).defaultNow().notNull(),
	clientsJson: longtext("clients_json").notNull(),
	conversationsJson: longtext("conversations_json").notNull(),
	ticketsJson: longtext("tickets_json").notNull(),
	botScriptsJson: longtext("bot_scripts_json").notNull(),
	operationalRecordsJson: longtext("operational_records_json").notNull(),
	auditLogsJson: longtext("audit_logs_json").notNull(),
	totalClients: int("total_clients").default(0).notNull(),
	totalConversations: int("total_conversations").default(0).notNull(),
	totalTickets: int("total_tickets").default(0).notNull(),
	status: mysqlEnum(['success','failed','partial']).default('success').notNull(),
	errorMessage: text("error_message"),
	retentionDays: int("retention_days").default(30).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdb_date").on(table.backupDate),
	index("idx_mdb_timestamp").on(table.backupTimestamp),
]);

export const megadeskDomainBotScripts = mysqlTable("megadesk_domain_bot_scripts", {
	scriptId: varchar("script_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	name: varchar({ length: 180 }).notNull(),
	description: text().notNull(),
	initialMessage: text("initial_message").notNull(),
	active: tinyint().default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdbs_client").on(table.clientId),
]);

export const megadeskDomainChamadoSequence = mysqlTable("megadesk_domain_chamado_sequence", {
	clientId: varchar({ length: 80 }).primaryKey().notNull(),
	nextChamadoNumber: int().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const megadeskDomainChamados = mysqlTable("megadesk_domain_chamados", {
	chamadoId: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	chamadoNumber: int().notNull(),
	customerId: varchar({ length: 80 }),
	customerName: varchar({ length: 255 }),
	customerPhone: varchar("customer_phone", { length: 40 }),
	customerEmail: varchar("customer_email", { length: 255 }),
	customerCNPJ: varchar("customer_cnpj", { length: 20 }),
	company: varchar({ length: 255 }),
	title: varchar({ length: 255 }),
	observations: text(),
	status: mysqlEnum(['open','in_progress','waiting','closed']).default('open'),
	priority: mysqlEnum(['baixa','media','alta','critica']).default('media'),
	assignedTo: varchar({ length: 80 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
	index("idx_mdc_status").on(table.status),
	index("uq_chamado_number").on(table.clientId, table.chamadoNumber),
]);

export const megadeskDomainChamadoActivities = mysqlTable("megadesk_domain_chamado_activities", {
	activityId: varchar("activity_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	description: text().notNull(),
	attendant: varchar({ length: 180 }).notNull(),
	actionType: mysqlEnum("action_type", ['register','edit','close','forward','note','attachment']).default('note').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdca_chamado").on(table.chamadoId),
	index("idx_mdca_client").on(table.clientId),
]);

export const megadeskDomainChamadoCollaborators = mysqlTable("megadesk_domain_chamado_collaborators", {
	collaboratorId: varchar("collaborator_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	userName: varchar("user_name", { length: 180 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdcc_chamado").on(table.chamadoId),
	index("idx_mdcc_client").on(table.clientId),
]);

export const megadeskDomainClientUsers = mysqlTable("megadesk_domain_client_users", {
	userId: varchar("user_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	name: varchar({ length: 180 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	role: mysqlEnum(['admin','manager','agent','viewer']).default('viewer').notNull(),
	status: mysqlEnum(['active','blocked']).default('blocked').notNull(),
	permissionsJson: longtext("permissions_json").notNull(),
	passwordHash: varchar("password_hash", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdu_client").on(table.clientId),
]);

export const megadeskDomainClients = mysqlTable("megadesk_domain_clients", {
	clientId: varchar("client_id", { length: 80 }).notNull(),
	internalId: varchar("internal_id", { length: 80 }).notNull(),
	tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	contact: varchar({ length: 180 }).notNull(),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 40 }).notNull(),
	cnpj: varchar({ length: 20 }),
	plan: varchar({ length: 120 }).notNull(),
	maxUsers: int("max_users").default(5).notNull(),
	status: mysqlEnum(['active','setup','paused']).default('setup').notNull(),
	statusType: mysqlEnum("status_type", ['active','test']).default('test').notNull(),
	accessReleased: tinyint("access_released").default(0).notNull(),
	apiToken: varchar("api_token", { length: 255 }).notNull(),
	modulesJson: longtext("modules_json").notNull(),
	integrationsJson: longtext("integrations_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("tenant_database_name").on(table.tenantDatabaseName),
]);

export const megadeskDomainConversations = mysqlTable("megadesk_domain_conversations", {
	conversationId: varchar("conversation_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	customerName: varchar("customer_name", { length: 180 }).notNull(),
	phone: varchar({ length: 40 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	status: mysqlEnum(['open','bot','closed']).default('open').notNull(),
	lastMessage: text("last_message").notNull(),
	timeLabel: varchar("time_label", { length: 80 }).notNull(),
	messagesJson: longtext("messages_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
]);

export const megadeskDomainCustomers = mysqlTable("megadesk_domain_customers", {
	customerId: varchar({ length: 80 }).notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	phone: varchar({ length: 20 }),
	email: varchar({ length: 255 }),
	company: varchar({ length: 255 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdc_client").on(table.clientId),
	index("idx_mdc_phone").on(table.phone),
]);

export const megadeskDomainMetrics = mysqlTable("megadesk_domain_metrics", {
	metricId: bigint("metric_id", { mode: "number" }).autoincrement().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	metricType: varchar("metric_type", { length: 80 }).notNull(),
	amount: int().default(1).notNull(),
	source: varchar({ length: 80 }).default('system').notNull(),
	metadataJson: longtext("metadata_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdm_client").on(table.clientId),
]);

export const megadeskDomainOperationalRecords = mysqlTable("megadesk_domain_operational_records", {
	recordId: varchar("record_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	tenantDatabaseName: varchar("tenant_database_name", { length: 120 }).notNull(),
	recordType: mysqlEnum("record_type", ['conversation','ticket','tracking','erp']).notNull(),
	ownerPhone: varchar("owner_phone", { length: 40 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	status: varchar({ length: 80 }).notNull(),
	payloadJson: longtext("payload_json").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdor_client").on(table.clientId),
	index("idx_mdor_tenant").on(table.tenantDatabaseName),
]);

export const megadeskDomainTickets = mysqlTable("megadesk_domain_tickets", {
	ticketId: varchar("ticket_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	company: varchar({ length: 255 }).notNull(),
	customer: varchar({ length: 180 }).notNull(),
	problem: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 120 }).notNull(),
	status: mysqlEnum(['open','in_progress','waiting','closed']).default('open').notNull(),
	createdLabel: varchar("created_label", { length: 80 }).notNull(),
	description: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mdt_client").on(table.clientId),
]);

export const megadeskWhatsappConfig = mysqlTable("megadesk_whatsapp_config", {
	configId: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	phoneNumberId: varchar({ length: 255 }),
	businessAccountId: varchar({ length: 255 }),
	accessToken: varchar({ length: 500 }),
	webhookVerifyToken: varchar({ length: 255 }),
	phoneNumber: varchar({ length: 20 }),
	webhookUrl: varchar({ length: 500 }),
	connectionStatus: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("uq_client_whatsapp").on(table.clientId),
]);

export const users = mysqlTable("users", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	openId: varchar("open_id", { length: 255 }).notNull(),
	name: varchar({ length: 255 }).default("Usuário MegaDesk").notNull(),
	email: varchar({ length: 255 }),
	loginMethod: varchar("login_method", { length: 64 }),
	role: mysqlEnum(['admin','user']).default('user').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastSignedIn: timestamp("last_signed_in", { mode: 'string' }),
},
(table) => [
	index("users_open_id_unique").on(table.openId),
	index("users_email").on(table.email),
]);

export const waAccounts = mysqlTable("wa_accounts", {
	accountId: varchar({ length: 80 }).notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	instanceId: varchar({ length: 255 }).notNull(),
	token: varchar({ length: 500 }),
	phoneNumber: varchar({ length: 20 }),
	connectionStatus: mysqlEnum(['connected','disconnected','qr_code_pending']).default('disconnected'),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_wa_client").on(table.clientId),
	index("idx_wa_instance").on(table.instanceId),
]);

export const waConversations = mysqlTable("wa_conversations", {
	conversationId: varchar({ length: 80 }).notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	phoneNumber: varchar({ length: 20 }).notNull(),
	customerName: varchar({ length: 255 }),
	lastMessage: text(),
	lastMessageTime: timestamp({ mode: 'string' }),
	unreadCount: int().default(0),
	status: mysqlEnum(['open','closed']).default('open'),
	assignedTo: varchar({ length: 80 }),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_wa_client").on(table.clientId),
	index("idx_wa_phone").on(table.phoneNumber),
	index("idx_wa_status").on(table.status),
]);

export const waMessages = mysqlTable("wa_messages", {
	messageId: varchar({ length: 80 }).notNull(),
	conversationId: varchar({ length: 80 }).notNull(),
	clientId: varchar({ length: 80 }).notNull(),
	sender: varchar({ length: 20 }),
	message: text(),
	messageType: mysqlEnum(['text','image','audio','video','document']).default('text'),
	mediaUrl: text(),
	status: mysqlEnum(['sent','delivered','read','failed','pending']).default('pending'),
	createdAt: timestamp({ mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_wm_conversation").on(table.conversationId),
	index("idx_wm_client").on(table.clientId),
	index("idx_wm_status").on(table.status),
]);

export const adminCredentials = mysqlTable("admin_credentials", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	active: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_admin_client").on(table.clientId),
	index("idx_admin_email").on(table.email),
	// Garantir que cada cliente tem apenas um admin por email
	// UNIQUE KEY `uq_admin_client_email` (`client_id`, `email`)
]);

// ─── Tabelas adicionais (Chamados, CRM) ──────────────────────────────────────

export const megadeskDomainChamadoAttachments = mysqlTable("megadesk_domain_chamado_attachments", {
	attachmentId: varchar("attachment_id", { length: 80 }).primaryKey().notNull(),
	chamadoId: varchar("chamado_id", { length: 80 }).notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	fileName: varchar("file_name", { length: 255 }).notNull(),
	fileUrl: text("file_url").notNull(),
	fileSize: int("file_size"),
	mimeType: varchar("mime_type", { length: 100 }),
	uploadedBy: varchar("uploaded_by", { length: 180 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
},
(table) => [
	index("idx_mdca_att_chamado").on(table.chamadoId),
	index("idx_mdca_att_client").on(table.clientId),
]);

export const megadeskCrmClients = mysqlTable("megadesk_crm_clients", {
	crmClientId: varchar("crm_client_id", { length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	companyName: varchar("company_name", { length: 255 }).notNull(),
	responsibleName: varchar("responsible_name", { length: 180 }).default("").notNull(),
	cpfCnpj: varchar("cpf_cnpj", { length: 20 }).default("").notNull(),
	phone: varchar({ length: 40 }).default("").notNull(),
	whatsapp: varchar({ length: 40 }).default("").notNull(),
	email: varchar({ length: 255 }).default("").notNull(),
	address: varchar({ length: 255 }).default("").notNull(),
	city: varchar({ length: 120 }).default("").notNull(),
	state: varchar({ length: 2 }).default("").notNull(),
	cep: varchar({ length: 10 }).default("").notNull(),
	status: mysqlEnum(['lead','ativo','inativo','cancelado','inadimplente']).default('lead').notNull(),
	origin: mysqlEnum(['whatsapp','instagram','facebook','site','indicacao','outro']).default('outro').notNull(),
	internalResponsible: varchar("internal_responsible", { length: 180 }).default("").notNull(),
	tags: text().default("").notNull(),
	observations: text().default("").notNull(),
	contactsJson: text("contacts_json"),
	lastInteractionAt: timestamp("last_interaction_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mcc_client").on(table.clientId),
	index("idx_mcc_status").on(table.status),
	index("idx_mcc_company").on(table.companyName),
	index("idx_mcc_phone").on(table.phone),
]);

export const megaadminCredentials = mysqlTable("megaadmin_credentials", {
	id: bigint({ mode: "number" }).autoincrement().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).default("Administrador").notNull(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	active: tinyint().default(1).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("megaadmin_email").on(table.email),
]);

// ─── User Settings e Shortcuts ───────────────────────────────────────────────

export const megadeskUserSettings = mysqlTable("megadesk_user_settings", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	notificationsEnabled: tinyint("notifications_enabled").default(1).notNull(),
	soundEnabled: tinyint("sound_enabled").default(1).notNull(),
	soundVolume: int("sound_volume").default(70).notNull(),
	muteUntil: timestamp("mute_until", { mode: 'string' }),
	desktopNotificationsEnabled: tinyint("desktop_notifications_enabled").default(1).notNull(),
	whatsappNotificationsEnabled: tinyint("whatsapp_notifications_enabled").default(1).notNull(),
	ticketsNotificationsEnabled: tinyint("tickets_notifications_enabled").default(1).notNull(),
	iaNotificationsEnabled: tinyint("ia_notifications_enabled").default(1).notNull(),
	showMessagePreview: tinyint("show_message_preview").default(1).notNull(),
	autoResponseEnabled: tinyint("auto_response_enabled").default(0).notNull(),
	autoResponseMessage: text("auto_response_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mus_client_user").on(table.clientId, table.userId),
]);

export const megadeskUserShortcuts = mysqlTable("megadesk_user_shortcuts", {
	id: varchar({ length: 80 }).primaryKey().notNull(),
	clientId: varchar("client_id", { length: 80 }).notNull(),
	userId: varchar("user_id", { length: 80 }).notNull(),
	shortcutKey: varchar("shortcut_key", { length: 50 }).notNull(),
	shortcutMessage: text("shortcut_message").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_mush_client_user").on(table.clientId, table.userId),
]);
