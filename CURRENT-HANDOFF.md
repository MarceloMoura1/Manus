# Current handoff

- Branch: `wip/conversations-0013-lifecycle`
- Base auditada: `561bf544eda16dca4d5ee782bd5adb437c43bd90`
- Alteração: clicar em `Todas` ou `Minhas` a partir de `Encerradas` abre diretamente a respectiva caixa de conversas abertas; o protocolo foi removido do cartão e cabeçalho.
- Protocolo: busca e contrato preservados; valor completo e cópia acessível disponíveis exclusivamente em `Mais ações → ID da conversa`.
- Semântica: Abertas contém somente `open` com atendente elegível; Minhas limita ao usuário autenticado; BOT contém somente `bot` sem responsável; Encerradas contém somente `closed` e não exibe contagem.
- Escopo: frontend, filtros/listagem/contagens do router de Conversas, testes diretamente afetados e este handoff; lifecycle, schemas, migrations e `pnpm-lock.yaml` preservados.
- Validações locais: testes direcionados, TypeScript, 1.189 testes Vitest, build e E2E Chromium em 390/768/1024/1440 px aprovados.
- Publicação: fluxo oficial `windows/Atualizar-MegaDesk.ps1 -RunTests`, preservando MySQL, Evolution e migration 0013.
