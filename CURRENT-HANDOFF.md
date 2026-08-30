# Current handoff

- Branch: `wip/conversations-0013-lifecycle`
- Base auditada: `54cb90b5c694d783ec99d03815478148c1b0e281`
- Alteração: escopo `Todas/Minhas` separado da caixa `Abertas/BOT/Encerradas`, com persistência em refresh, troca de página e voltar/avançar.
- Semântica: Abertas contém somente `open` com atendente elegível; Minhas limita ao usuário autenticado; BOT contém somente `bot` sem responsável; Encerradas contém somente `closed` e não exibe contagem.
- Escopo: frontend, filtros/listagem/contagens do router de Conversas, testes diretamente afetados e este handoff; lifecycle, schemas, migrations e `pnpm-lock.yaml` preservados.
- Validações locais: filtros e tenant, TypeScript, `db:validate`, 1.189 testes Vitest, build e E2E Chromium em 390/768/1024/1440 px aprovados.
- Publicação: fluxo oficial `windows/Atualizar-MegaDesk.ps1 -RunTests`, preservando MySQL, Evolution e migration 0013.
