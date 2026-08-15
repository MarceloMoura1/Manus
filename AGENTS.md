# AGENTS.md

## Ambiente e comandos

- Use Node.js 22 e pnpm 10.18.0.
- Instale com `pnpm install --frozen-lockfile`.
- Verificação de tipos: `pnpm check`.
- Testes: `pnpm test` (ou `pnpm vitest run <arquivo>` para um conjunto específico).
- Build: `pnpm run build`.
- Desenvolvimento: `pnpm dev` em shells POSIX. Os scripts `dev` e `start` usam a sintaxe POSIX de `NODE_ENV`; no Windows CMD/PowerShell, defina `NODE_ENV` antes e execute o comando subjacente, ou use um shell compatível.
- Arquitetura e comandos de migrations: `docs/MIGRATIONS.md`. Nunca execute a cadeia histórica diretamente em `drizzle/`.

## Arquitetura resumida

O MegaDesk é uma aplicação TypeScript com frontend React/Vite, backend Express/tRPC e persistência MySQL/Drizzle. O banco principal mantém o cadastro e o controle de acesso dos tenants; cada tenant pode ter banco físico isolado. A Evolution API e seu MySQL são serviços Docker separados configurados por `docker-compose.evolution.yml`.

## Segurança operacional

- Nunca abra, imprima ou versione arquivos `.env` reais; use `.env.example` apenas como catálogo.
- Não execute migrations, seeds, dumps ou restaurações sem autorização explícita.
- Não inicie, remova ou recrie containers e volumes durante verificações. Nunca use `docker compose down -v` em dados existentes.
- A ação administrativa comum de remoção coloca o tenant em quarentena (`paused`, acesso bloqueado) e preserva dados e banco físico. Exclusão física permanece bloqueada até existir autorização operacional e evidência verificável de backup.
