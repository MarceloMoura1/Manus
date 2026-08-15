# Dívida de migration: system prompt dos bots

Não foi criada migration nesta rodada porque a sequência versionada não é inequívoca: há nomes no `drizzle/meta/_journal.json` que não correspondem aos arquivos SQL presentes (por exemplo, entradas `0001`, `0002`, `0007` e `0018`). Gerar manualmente uma próxima migration sem resolver essa divergência poderia produzir uma cadeia que não representa todos os ambientes.

Até a decisão, a API rejeita novas gravações de `systemPrompt` e bloqueia a execução baseada no campo legado `description`. Leituras gerais também ocultam `description`, pois os registros existentes podem conter prompts legados indistinguíveis de descrições públicas.

Antes de uma migration aditiva, é necessário:

1. reconciliar journal, snapshots e SQL aplicado por ambiente;
2. auditar quais valores de `description` são descrição pública ou prompt legado;
3. definir autorização para leitura e edição de prompts;
4. adicionar `system_prompt` sem remover nem sobrescrever `description`;
5. executar backfill auditável somente nos registros classificados como legado;
6. avaliar duplicidades de `wa_accounts.phone_number_id` e a constraint unique apropriada por conta/tenant antes de qualquer constraint nova.
