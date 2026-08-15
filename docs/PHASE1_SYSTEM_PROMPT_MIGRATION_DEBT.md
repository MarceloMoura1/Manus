# Dívida encerrada: system prompt dos bots

Esta dívida foi encerrada pela baseline canônica para instalações limpas. A
cadeia histórica inconsistente foi congelada e não é mais alcançada pelos
comandos operacionais.

`description` e `system_prompt` agora são colunas distintas. Listagens comuns
retornam somente a descrição pública; rotas autenticadas de detalhe e edição
podem acessar o prompt. Não existe backfill porque não há dados implantados.

Referências canônicas:

1. `drizzle/schema.ts`;
2. `drizzle/main-migrations/`;
3. `docs/MIGRATIONS.md`.
