# Reconciliador Oracle + Windows

Este diretório contém o reconciliador de staging do MegaDesk. Ele aceita apenas
MySQL em loopback e bancos com prefixo `megadesk_test_`, sempre restaurados de
backups. O plano usa `BLOCK_FAIL_CLOSED`: dados tenant-scoped em tabela não
classificada interrompem a execução.

O plano versionado está em `reconciliation-plan.json`. O mapping operacional é
um JSON separado e não versionado, contendo somente fingerprints SHA-256:

```json
{
  "sourceTenantSha256": "...",
  "targetTenantSha256": "...",
  "sourceAdminEmailSha256": "...",
  "targetAdminEmailSha256": "..."
}
```

Execução:

```text
RECON_SOURCE_URL=mysql://.../megadesk_test_windows_source \
RECON_TARGET_URL=mysql://.../megadesk_test_oracle_canonical \
RECON_MAPPING_FILE=/caminho/mapping.json \
RECON_REPORT_FILE=/caminho/report.json \
node scripts/reconciliation/reconciler.mjs reconcile
```

O target precisa estar em `0036_spicy_zeigeist`. As tabelas auxiliares
`_reconciliation_entity_map` e `_reconciliation_audit` existem somente no
staging e são excluídas do fingerprint lógico final.

Para preparar um banco físico exclusivamente descartável, use o runner
`apply-staging-migrations.ts` com `RECON_TARGET_URL`. Ele possui as mesmas
barreiras de loopback e namespace e não substitui o migrator de produção.

Cada grupo declarado em `transactionGroups` é atômico. Contato, conversa,
mensagem e evento formam um único agregado transacional; falha de domínio,
mapping ou auditoria reverte o grupo inteiro. Mappings já existentes são
reatestados contra a identidade determinística e a linha canônica antes de um
replay ser aceito.

O detector inspeciona também JSONs de provider e mídia. O campo estrutural
`providerMessageReference.message.messageContextInfo.messageSecret` é tratado
como payload criptográfico da própria mensagem (persistido pelo modelo
canônico), não como credencial operacional. Tokens, cookies, senhas, chaves de
API e outros secrets fora desse caminho exato bloqueiam o run.

Depois da reconciliação, `validate-staging.mjs` verifica causalmente o journal,
todos os FKs e índices únicos, isolamento de tenant, preservação do baseline
Oracle, união de mensagens, receipt, estoque, compras, financeiro e auditoria.
Source, baseline e target devem ser três databases distintos. O validador
também rejeita qualquer database fora do namespace descartável ou fora de
loopback. O merge de storage exige o target database para provar referências,
exige roots Windows/Oracle/canônico disjuntos, valida hash, tamanho,
normalização e colisão de case, bloqueia traversal, symlink/hardlink e nunca
sobrescreve um target.
