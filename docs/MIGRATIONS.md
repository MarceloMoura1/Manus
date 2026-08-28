# Arquitetura canônica de migrations

O MegaDesk possui duas fontes de schema próprias. O banco externo da Evolution
API é administrado exclusivamente pela Evolution e nunca entra nas migrations
do MegaDesk.

| Banco | Schema | Baseline | Conteúdo |
|---|---|---|---|
| Main/shared | `drizzle/schema.ts` | `drizzle/main-migrations/` | 31 tabelas compartilhadas, incluindo filas internas Evolution |
| Tenant `mdsk_*` | `drizzle/tenant-schema.ts` | `drizzle/tenant-migrations/` | 7 tabelas fisicamente isoladas |

## Inventário main

| Área | Tabelas ativas | Chave tenant |
|---|---|---|
| Autenticação/admin | `users`, `megaadmin_credentials`, `admin_credentials` | `admin_credentials.client_id` |
| Tenants | `megadesk_domain_clients`, `megadesk_domain_client_users` | `client_id` |
| Atendimento | chamados, sequência, atividades, colaboradores, anexos e tickets | `client_id` |
| Conversas/CRM | conversas, customers e `megadesk_crm_clients` | `client_id` |
| WhatsApp | `wa_accounts`, `wa_conversations`, `wa_messages`, config | `client_id` |
| Configuração | company/user settings, shortcuts, bot scripts e notificações | `client_id` |
| Operação | métricas, registros, auditoria e backups | `client_id` quando aplicável |
| Retry Evolution interno | failed messages, retry history, queue config e metrics | `client_id` |

`description` é informação pública do roteiro; `system_prompt` é separado e só
é retornado por rotas autenticadas de detalhe/administração. Listagens comuns
não selecionam o prompt.

## Inventário tenant

Cada banco `mdsk_*` contém `conversations`, `tickets`, `bot_scripts`,
`operational_records`, `users`, `integrations` e `audit_logs`. O isolamento é
físico; não são replicadas as tabelas administrativas do main.

## Comandos

Geração é local e não conecta ao banco:

```text
pnpm db:generate:main
pnpm db:generate:tenant
pnpm db:validate
```

Aplicação é separada e exige consentimento explícito no processo:

```text
ALLOW_MAIN_MIGRATION=1 MAIN_DATABASE_URL=mysql://.../banco pnpm db:migrate:main
ALLOW_TENANT_MIGRATION=1 TENANT_DATABASE_URL=mysql://.../mdsk_cliente pnpm db:migrate:tenant
```

O runner tenant rejeita nomes fora de `mdsk_*`. URLs não possuem default. Nunca
use `db:push`; ele foi removido.

## Compatibilidade CRM Pessoa/Empresa

`megadesk_crm_clients.customer_type` classifica `person` ou `company` e permanece
anulável durante a transição dos registros legados. Para Pessoa, `company_name`
continua armazenando provisoriamente o nome completo; essa dívida evita uma segunda
coluna e deve ser resolvida apenas em uma evolução futura explicitamente autorizada.

## Auditoria estruturada da Evolution

A migration main `0012` adiciona campos nullable de correlação, identidade,
origem, fase, erro seguro, IP e metadata JSON à tabela
`megadesk_domain_audit_logs`. A nulabilidade preserva os registros legados sem
backfill. Para novos eventos Evolution, a aplicação exige esses campos e usa
`success = NULL` apenas na fase `intent`; `success` e `failure` usam 1 e 0.

## Legado

A cadeia antiga permanece para auditoria, descrita em
`drizzle/LEGACY_MIGRATIONS_DO_NOT_RUN.md`. Configs, runners e scripts padrão não
alcançam seus SQLs ou snapshots. Scripts avulsos antigos foram bloqueados.
# Estado do schema tenant

O runtime da Fase 1 usa isolamento lógico tenant-aware no banco main. `tenant-schema.ts` e sua baseline permanecem como contrato de referência, mas **não são operacionais**: não há repositories consumindo esses símbolos e o comando de aplicação tenant está bloqueado. O provisioning físico deve permanecer desativado até que repositories, transações, readiness e testes de integração específicos sejam implementados.
