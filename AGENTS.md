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
- É proibido iniciar, remover ou recriar containers e volumes durante verificações comuns.
- Exceção: testes físicos de integração podem criar recursos Docker exclusivamente descartáveis quando o usuário autorizar explicitamente a operação na tarefa atual, houver finalidade concreta que não possa ser atendida apenas por mocks e forem definidos previamente nomes exatos de container, volume, rede e database, além de imagem, porta e escopo.
- A exceção nunca autoriza alterar, reiniciar, parar, recriar, reutilizar ou remover containers, volumes, redes ou bancos reais do MegaDesk, MySQL main ou Evolution. Ela não é uma autorização permanente: cada tarefa exige autorização explícita própria.

### Condições da exceção descartável

Todas as condições abaixo são obrigatórias:

- container, volume, rede, database e porta devem ter nomes ou valores exatos definidos antes da criação;
- os recursos devem ser comprovadamente inexistentes antes da criação;
- o database deve ter prefixo `megadesk_test_`;
- credenciais e senhas devem ser exclusivamente sintéticas;
- a imagem Docker deve ser explicitamente permitida e fixada;
- containers, volumes, redes e bancos reais nunca podem ser reutilizados;
- a aplicação de teste não pode se conectar ao main ou à Evolution;
- arquivos `.env` reais e segredos reais não podem ser lidos ou usados;
- o estado dos recursos protegidos deve ser registrado antes e depois;
- a limpeza deve remover exclusivamente os recursos criados pela própria tarefa e confirmar ao final que portas e recursos descartáveis estão livres.

### Recursos protegidos permanentemente

Nunca alterar durante testes descartáveis:

- `megadesk-local-mysql`;
- `megadesk_local`;
- `megadesk_local_mysql_data`;
- porta `3308`;
- `megadesk-evolution`;
- `megadesk-evolution-db`;
- `megadesk_evolution_instances`;
- `megadesk_evolution_store`;
- `megadesk_evolution_db`;
- porta `8080`;
- containers, volumes, redes ou bancos não criados pela própria tarefa.

### Proibições permanentes

Mesmo com autorização descartável, nunca execute:

- `docker compose down`;
- `docker compose down -v`;
- `docker system prune`;
- `docker volume prune`;
- remoção por glob;
- remoção por label ambígua;
- reutilização de volume real;
- montagem read-write de volume real;
- conexão da aplicação de teste ao main;
- conexão com Evolution real;
- leitura de credenciais em `.env`;
- uso de senha real;
- exclusão de recurso não comprovadamente descartável.

### Preflight obrigatório

Antes da criação:

- valide a regex dos nomes e exija prefixo ou sufixo de teste;
- confirme que a porta está livre;
- confirme que container, volume e rede não existem;
- confirme que o database é distinto do main e da Evolution e possui prefixo `megadesk_test_`;
- registre os IDs dos recursos reais protegidos;
- confirme que a imagem permitida está fixada explicitamente.

### Limpeza obrigatória

Depois do teste:

- remova somente o container criado pela tarefa;
- remova somente o volume criado pela tarefa;
- remova somente a rede criada pela tarefa;
- confirme que as portas estão livres;
- confirme que os recursos reais mantêm os mesmos IDs, health e restart count;
- remova os temporários criados pela tarefa;
- reporte qualquer recurso que não tenha sido removido.

Em caso de identidade ambígua, não crie nem remova recursos e retorne `NÃO PRONTO`.
- A ação administrativa comum de remoção coloca o tenant em quarentena (`paused`, acesso bloqueado) e preserva dados e banco físico. Exclusão física permanece bloqueada até existir autorização operacional e evidência verificável de backup.
