# Current handoff

- Branch: `wip/conversations-0013-lifecycle`
- Base auditada: `5b4c7c172c74dc0c45e64523df4c3e55c45fc146`
- Alteração: ordem visual dos filtros de Conversas restaurada para `Todas | Minhas | Encerradas` e `Abertas | BOT`.
- Escopo: frontend, testes diretamente afetados e este handoff; backend, lifecycle, queries, schemas, migrations e `pnpm-lock.yaml` preservados.
- Validações locais: TypeScript, teste estrutural direcionado, E2E Chromium em 390/768/1024/1440 px, build e `git diff --check` aprovados.
- Publicação: fluxo oficial `windows/Atualizar-MegaDesk.ps1 -RunTests`, preservando MySQL, Evolution e migration 0013.
