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
entrada com o manifesto. O manifesto fica fora do TAR para evitar referência
circular.

## Empacotamento de dependências pnpm

O diretório `node_modules` produzido pelo pnpm contém symlinks relativos para
o store `.pnpm`. Eles são parte do runtime: **não use `tar --dereference`**.
O uso dessa opção transforma alguns links em cópias incompletas e pode deixar
dependências transitivas, como `detect-libc` do `sharp`, fora da resolução do
Node.

Use o empacotador versionado, depois de `release:assemble-runtime`:

```bash
pnpm release:package-runtime -- package \
  --runtime "$RUNTIME" \
  --tar /caminho/novo/megadesk-runtime.tar.gz \
  --manifest /caminho/novo/megadesk-runtime.manifest.json \
  --extract /caminho/novo/megadesk-runtime-reextract \
  --commit "$(git rev-parse HEAD)" \
  --tree "$(git rev-parse HEAD^{tree})" \
  --node "$(node --version)" \
  --pnpm "$(pnpm --version)"
```

O manifesto de esquema 2 registra arquivos regulares (`type: "file"`,
tamanho e SHA-256) e symlinks (`type: "symlink"`, alvo literal e hash do
alvo). O gerador não percorre links. Para cada link ele rejeita alvo absoluto,
escape lexical por `..`, destino quebrado, ciclo e qualquer cadeia cujo destino
real saia do payload. A extração limpa exige que os nomes do TAR permaneçam
abaixo da raiz declarada e a verificação repete a validação estrutural e os
hashes.

O comando recusa destinos preexistentes e só retorna sucesso depois de
reextrair o TAR no diretório indicado e verificar integralmente o manifesto.
Para uma conferência posterior, execute:

```bash
pnpm release:package-runtime -- verify \
  --runtime /caminho/extraido/runtime \
  --manifest /caminho/novo/megadesk-runtime.manifest.json
```

O gate ARM64 continua exigindo o import e uma transformação real de `sharp`
no runtime extraído; uma checagem superficial de `require.resolve("sharp")`
não prova que suas dependências transitivas foram preservadas.

## Contrato de ferramentas de audio no Linux

`ffmpeg-static` e `ffprobe-static` permanecem dependencias de producao para o
runtime Windows nativo. Elas nao devem ser resolvidas nem executadas durante a
validacao Linux ARM64: `outboundAudioRuntimeExecutable` seleciona
`/usr/bin/ffmpeg` e `/usr/bin/ffprobe` antes de tentar resolver os pacotes
estaticos. O `Dockerfile.app-runtime` e o contrato versionado que instala o
pacote de sistema `ffmpeg`, que fornece ambos os executaveis para a imagem
Linux.

Portanto, o gate Linux ARM64 deve validar `sharp` e os imports efetivamente
usados pelo runtime montado, alem da selecao dos caminhos de sistema. A
execucao fisica de FFmpeg/FFprobe pertence ao gate da imagem Linux, nao ao
artefato Node isolado. A ausencia de `bin/linux/arm64/ffprobe` em
`ffprobe-static` nao representa a ausencia da ferramenta de runtime Linux.

## Limites

Esta receita é exclusivamente de preparação de artefato. Backup consistente,
write-freeze, migration, modificação do bind mount `/app`, recriação do app e
promoção requerem autorização operacional separada.
