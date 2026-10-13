# Montagem de runtime Linux ARM64

`pnpm --filter megadesk-platform --prod deploy --legacy` instala o pacote e as
dependências de produção; ele não inclui `dist/`, pois o diretório é ignorado
pelo Git. Portanto, uma saída zero desse comando não demonstra que o runtime
é inicializável.

Esta receita monta uma candidata isolada. Ela não ativa uma release, não roda
migrations e não toca no Compose ou em containers.

## Entradas

- checkout limpo, no commit que será publicado, após `pnpm run build`;
- destino novo criado por `pnpm deploy`, no mesmo filesystem da candidata;
- Node e pnpm compatíveis com o lockfile, em Linux ARM64 nativo.

O destino não pode existir antes de `pnpm deploy` e não pode receber arquivos
de ambiente. O checkout de origem não pode ser a release ativa.

## Sequência obrigatória

```bash
RUNTIME=/caminho/da/candidata/runtime
pnpm --filter megadesk-platform --prod deploy --legacy "$RUNTIME"
pnpm release:assemble-runtime -- --source "$PWD" --runtime "$RUNTIME"
node --experimental-vm-modules windows/Assert-MegaDeskProductionRelease.mjs --release "$RUNTIME"
```

`release:assemble-runtime` falha se o build de origem não contém
`dist/index.js`, `dist/public/index.html` ou `dist/public/assets`; também
recusa sobrescrever um `dist/` já existente no destino. Depois de copiar o
build para uma área temporária dentro da candidata, ele valida a estrutura e
faz um rename atômico para `runtime/dist`. Arquivos `.env*` na raiz copiados
por `pnpm deploy` são removidos antes da validação.

O validador também exige `package.json`, `node_modules` próprio, todas as
dependências de produção declaradas e que qualquer symlink resolva dentro do
runtime. O verificador versionado em `windows/` complementa a checagem ao
resolver os imports estáticos de `dist/index.js` exclusivamente pelo
`node_modules` da candidata.

## Gates de candidata ARM64

Antes de montar o runtime, execute no checkout isolado:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:validate
RUN_DATABASE_INTEGRATION=0 pnpm vitest run
pnpm run build
pnpm vitest run scripts/operations/assemble-runtime-release.test.mjs
```

Depois da montagem e do verificador de imports, valide os imports funcionais
dos módulos nativos na própria candidata. Só então gere um TAR e um manifesto
externo com hashes SHA-256, reextraia o TAR em diretório vazio e compare cada
arquivo com o manifesto. O manifesto fica fora do TAR para evitar referência
circular.

## Limites

Esta receita é exclusivamente de preparação de artefato. Backup consistente,
write-freeze, migration, modificação do bind mount `/app`, recriação do app e
promoção requerem autorização operacional separada.
