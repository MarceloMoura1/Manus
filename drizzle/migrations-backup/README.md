# Migrações Legadas

Esta pasta contém arquivos SQL que foram removidos do fluxo principal de migrações
por serem duplicados ou pertencerem a módulos legados.

## Por que foram removidos?

| Arquivo | Motivo |
|---------|--------|
| `LEGACY_evolution_schema_0000_*` | Schema da Evolution API — não faz parte do MegaDesk |
| `LEGACY_old_client_users_0003_*` | ALTER TABLE em tabela `client_users` que não existe mais |
| `LEGACY_operational_metric_0004_*` | Tabela de métricas operacionais — substituída |
| `LEGACY_operational_data_0005_*` | Tabela de dados operacionais — substituída |
| `LEGACY_api_audit_logs_0006_*` | Tabela de audit logs de API — substituída |
| `LEGACY_tenants_table_0010_*` | Tabela para DB-per-tenant — não usada no modelo atual |
| `LEGACY_duplicate_company_settings_0018_*` | Duplicata do 0018_company_settings.sql |

## Como usar

Estes arquivos são apenas para referência histórica. NÃO os aplique no banco de dados.
Use apenas os arquivos SQL da pasta `drizzle/` principal.
