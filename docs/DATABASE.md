# MegaDesk — Banco de Dados

## Configuração

- **Motor:** MySQL 8.0+
- **ORM:** Drizzle ORM
- **Charset:** utf8mb4 (suporte completo a emoji e caracteres especiais)
- **Banco principal:** `megadesk_main`
- **Padrão multitenancy:** Shared DB com `client_id` em todas as tabelas

## Criar banco (uma vez)

```sql
CREATE DATABASE megadesk_main CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'megadesk'@'localhost' IDENTIFIED BY 'SuaSenha';
GRANT ALL PRIVILEGES ON `megadesk_%`.* TO 'megadesk'@'localhost';
FLUSH PRIVILEGES;
```

## Aplicar schema

```bash
pnpm db:validate
# Após autorização explícita e configuração no processo:
pnpm db:migrate:main
```

## Tabelas principais

### Administração (MegaAdmin)

| Tabela | Descrição |
|--------|-----------|
| `megaadmin_credentials` | Credenciais do admin mestre da plataforma |
| `megadesk_domain_clients` | Clientes SaaS (empresas) |
| `megadesk_domain_client_users` | Usuários de cada cliente |
| `megadesk_company_settings` | Configurações da empresa do cliente |

### Atendimento

| Tabela | Descrição |
|--------|-----------|
| `megadesk_domain_conversations` | Conversas WhatsApp |
| `megadesk_domain_chamados` | Chamados/tickets |
| `megadesk_domain_chamado_activities` | Atividades dos chamados |
| `megadesk_domain_chamado_collaborators` | Colaboradores de chamados |
| `megadesk_domain_chamado_attachments` | Anexos de chamados |
| `megadesk_domain_chamado_sequence` | Numeração sequencial por cliente |

### CRM

| Tabela | Descrição |
|--------|-----------|
| `megadesk_crm_clients` | Clientes do CRM |

### WhatsApp

| Tabela | Descrição |
|--------|-----------|
| `megadesk_whatsapp_config` | Configuração WhatsApp por cliente |

### Usuários e Configurações

| Tabela | Descrição |
|--------|-----------|
| `megadesk_user_settings` | Configurações de usuário (notificações, etc.) |
| `megadesk_user_shortcuts` | Atalhos de mensagens do usuário |
| `megadesk_domain_bot_scripts` | Scripts do bot IA |

### Outros

| Tabela | Descrição |
|--------|-----------|
| `users` | Usuários OAuth (integração Manus) |
| `megadesk_domain_metrics` | Métricas de uso |
| `megadesk_domain_backups` | Registro de backups |
| `evolution_failed_messages` | Fila de retry de mensagens |

## Migrações

As migrations canônicas ficam em `drizzle/main-migrations/` e
`drizzle/tenant-migrations/`. Consulte `docs/MIGRATIONS.md`.

```bash
# Gerar SQL local sem aplicar
pnpm db:generate:main
pnpm db:generate:tenant

# Ver estado atual do banco
npx drizzle-kit studio
```

### Pasta migrations-backup/

Os SQLs antigos diretamente em `drizzle/`, `drizzle/meta/`, `drizzle/migrations/`
e `migrations-backup/` são somente auditoria e não podem ser aplicados.

## Backup manual

```bash
mysqldump -u megadesk -p megadesk_main > backup_$(date +%Y%m%d_%H%M%S).sql
```

## Restaurar backup

```bash
mysql -u megadesk -p megadesk_main < backup_20240101_120000.sql
```
