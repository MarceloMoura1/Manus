# Qualificacao da imagem ARM64 do E2E de Vendas V5

`Dockerfile.e2e-arm64` descreve uma imagem candidata para os tres executores
descartaveis de `scripts/ops/megadesk-sales-v5-e2e.sh`: migration, runtime e
Playwright. Ela nao e uma imagem de producao e nao publica artefatos por si.

## Manifesto de proveniencia

O manifesto-candidato
`.github/qualification-provenance/sales-v5-e2e-chromium-arm64.json` e a politica
separada `.github/qualification-provenance/sales-v5-e2e-chromium-arm64-policy.json`
formam a cadeia versionada. O primeiro descreve somente a candidata e o segundo
e a allowlist de tuplas explicitamente aprovadas. Nesta revisao, eles fixam a
candidata completa, sem `finalImage`: a origem Node ARM64, o snapshot Debian,
o tarball pnpm, a URL oficial do Chromium, tamanho e SHA-256 reais, e as
evidencias hashadas de aquisicao, extracao e aprovacao.

Somente um manifesto-candidato e uma politica `approved` completos podem liberar
o gerador. Eles precisam
conter, separadamente, o digest de indice, o digest do manifesto especifico
`linux/arm64`, o digest de configuracao da imagem-base, a versao/revisao do
Playwright/Chromium, o arquivo arquivado, SHA-256, tamanho, manifesto de
arquivos extraidos e tres evidencias hashadas: aquisicao, extracao e aprovacao.
`finalImage` permanece obrigatoriamente `null` no manifesto-fonte; identidade da
imagem final so pode constar de evidencia gerada pela qualificacao real.

O manifesto de arquivos extraidos possui linhas
`SHA-256<espaco>tamanho-em-bytes<espaco>caminho-relativo`, em ordem lexica C,
sem linhas vazias. A fonte oficial deste caso e um ZIP. Antes de `unzip` poder
escrever, o verificador recusa ZIP64, multi-disco, criptografia, data
descriptors, nomes inseguros, traversal, links e outros tipos Unix, entradas
duplicadas e colisao arquivo/diretorio; ele verifica tamanho descomprimido e
CRC32 enquanto deriva os hashes do manifesto. O mesmo verificador continua
aceitando somente TAR POSIX USTAR quando o formato declarado for `tar.gz`.
A arvore extraida e comparada integralmente contra o manifesto, com hashes e
tamanhos.

O workflow manual nao recebe entradas que alterem imagem-base, APT ou pnpm. Ele
valida o manifesto e todos os arquivos de evidencia antes de baixar o unico ZIP
permitido, confere novamente seu tamanho e SHA-256, gera o unico Dockerfile
utilizavel, congela todos os inputs em um contexto novo fora do checkout e
verifica o inventario SHA-256 desse contexto imediatamente antes do build.
Enquanto a proveniencia estiver `pending`, o validador encerra com codigo 78
antes de download, `pnpm install` ou `docker build`.

As Actions que preparam o runner estao fixadas por SHA completo, resolvido
diretamente dos releases oficiais: `actions/checkout` v4.2.2 em
`11bd71901bbe5b1630ceea73d27597364c9af683`, `actions/setup-node` v4.4.0
em `49933ea5288caeca8642d1e84afbd3f7d6820020` e `pnpm/action-setup`
v4.2.0 em `9fd676a19091d4595eefd76e4bd31c97133911f1`; a retencao de
evidencias usa `actions/upload-artifact` v4.6.2 em
`ea165f8d65b6e75b540449e92b4886f43607fa02`. O checkout recebe
somente `contents: read`, com `persist-credentials: false`; nenhum token e
montado no container. O workflow nao recebe `packages: write`, nao faz login
e nao faz push de imagem. Tags mutaveis permanecem proibidas.

## Procedencia registrada do Chromium

O tag oficial Playwright `v1.60.0`
(`87bb9ddbd78f329df18c2b24847bc9409240cd07`) fixa Chromium revisao `1223`,
versao `148.0.7778.96`. A URL usada pelo proprio registry do Playwright para
Linux ARM64 e
`https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1223/chromium-linux-arm64.zip`.
Uma unica aquisicao autorizada em 2026-10-20 resultou em 194706293 bytes e
SHA-256 `3f7fd102f646dad864a987de04782e238e98a3d38543a1c8be0129b96706a283`.
O ETag ou o status HTTP nao sao usados como prova de integridade. O ZIP nao e
versionado no Git: o workflow somente pode baixa-lo da URL fixada depois de
validar a politica e precisa reproduzir exatamente o mesmo tamanho e hash.

A imagem-base e `node:22.23.2-bookworm-slim`, vinculada ao indice OCI
`sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`,
ao manifesto Linux ARM64
`sha256:f71fb9ca71b1b47d4d1a009af78147ed6cdc74f9c7cfc36cbde78ff985169051`
e a config
`sha256:51b9818dc6f8956f76859097b197aaf762d8639491354ad43ec35b505c87b9cc`.
O pnpm 10.18.0 vem do tarball oficial NPM fixado por SHA-256
`3967a3efe2909df305fec4b833a304dfca17c380b6bb77672f4dac4f2cdd3788`; os
pacotes Debian sao resolvidos apenas do snapshot datado registrado na politica.
O `Dockerfile.e2e-arm64`
versionado e apenas um sentinela `FROM scratch` nao-buildavel: ele nao aceita
`ARG NODE_BASE_IMAGE` nem pode resolver uma imagem remota arbitraria em build
direto. A existencia futura de um arquivo de proveniencia, por si so, tambem
nao o aprova: sua estrutura, origem, checksum, plataforma e cadeia de
validacao precisam ser revisados em uma alteracao separada. O Dockerfile
utilizavel nunca e o arquivo versionado: ele e gerado somente dentro do contexto
congelado a partir de uma politica aprovada.

Em particular, esta qualificacao nao usa `playwright install chromium`, URL
inventada, checksum inventado ou imagem oficial Playwright presumidamente
compativel com ARM64. A execucao ARM64 real ainda e obrigatoria: as evidencias
de entrada nao substituem build, browser, `ldd` ou `sharp` reais.

## Contrato de imagem

A imagem deve manter `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`. O runner
configura `HOME=/tmp`; sem esse caminho explicito, Playwright 1.60 procuraria
por padrao em `~/.cache/ms-playwright`, que seria temporario.

O checkout e seu `node_modules` congelado sao montados em `/workspace` pelo
runner; portanto `tsx`, o codigo da aplicacao e `sharp` sao resolvidos a partir
desse checkout ARM64, enquanto `node`, `pnpm` e Chromium vem da imagem. O
verificador exige `pnpm exec tsx --version` antes de testar o runtime e mede
uma transformacao real com `sharp`. Isso comprova o contrato combinado e nao
atribui incorretamente ao Dockerfile dependencias que o runner fornece pelo
mount somente leitura.

O Dockerfile descreve as bibliotecas Linux requeridas pelo Chromium aprovado em
Debian: ALSA, ATK, Cairo, CUPS, DBus, DRM, EGL, GBM, GLib, GTK, NSS, Pango,
Wayland, X11/XCB, XComposite, XDamage, XExt, XFixes, XKBCommon e XRandR. O
teste real executara `ldd` e falhara caso qualquer biblioteca fique ausente.

O usuario padrao e explicitamente `root` porque o contrato atual do runner nao
usa `--user` e monta a raiz de midia criada pelo operador. Isso nao equivale a
aprovacao: o workflow deve iniciar Chromium sob `--read-only`, `--cap-drop
ALL`, `no-new-privileges`, `/tmp` temporario e `--network none`. Falha nesse
probe bloqueia a imagem; nao se deve adicionar `--no-sandbox` ou relaxar o
runner sem revisao separada.

## Gates de qualificacao futura

Os testes locais estaticos verificam o manifesto, a recusa de origem
fora da allowlist, plataforma diferente de `linux/arm64`, revisao Chromium
divergente, evidencia incompleta, arquivo ausente, tamanho/hash divergente,
`finalImage` prematuro, Dockerfile dinamico, contexto congelado alterado e
geracao nao deterministica. Eles tambem verificam a ligacao do indice OCI ao
manifesto especifico `linux/arm64` e ao `configDigest` aprovado. Eles usam
fixtures sinteticas somente nos testes; nenhum valor sintetico e gravado no
manifesto de proveniencia.

Esses testes nao qualificam browser, imagem, arquitetura ou bibliotecas. A
prova real exige um executor ARM64 e evidencias externas revisadas. O repositorio
consegue vincular uma referencia literal a uma allowlist versionada e falhar
fechado; nao consegue provar sozinho a imutabilidade de um registry, assinatura
do fornecedor, protecao de branch, disponibilidade de um runner ARM64 ou a
retencao do arquivo arquivado.

O workflow manual
`qualify-sales-v5-e2e-image-arm64.yml` deve comprovar em executor ARM64 real:

1. runner real `Linux/aarch64` e Docker `linux/arm64`;
2. imagem produzida com `Os=linux` e `Architecture=arm64`; o digest especifico
   da base aprovado no manifesto e conferido separadamente do ID/digest final local da imagem;
   o executavel Chromium tambem recebe SHA-256 no relatorio;
3. Node `v22.23.2`, pnpm `10.18.0` e Playwright `1.60.0`;
4. `tsx` disponivel no checkout montado e browser em `/opt/ms-playwright` com
   `HOME=/tmp`;
5. `pnpm exec playwright --version`, `ldd` sem dependencias ausentes e pagina
   `data:` aberta por Chromium;
6. importacao e transformacao PNG reais por `sharp` usando o `node_modules`
   ARM64 instalado de forma congelada no checkout montado.

O digest da base identifica a imagem de origem solicitada para o build. Depois
do probe real, o workflow exporta uma imagem OCI e registra separadamente o
digest do indice, do manifesto Linux ARM64 e da config. Eles nao sao
intercambiaveis com o `Id` local do Docker. O workflow nao publica esse layout:
sem decisao separada de registry e autorizacao para publicar, o resultado e uma
imagem efemera de CI acompanhada de evidencias. `MEGADESK_E2E_RUNTIME_IMAGE`
continua indefinida, e o preflight do Ubuntu permanece bloqueado.

## Arquivos e limites

Esta qualificacao futura nao executa migrations, nao inicia o runtime do
MegaDesk, nao cria MySQL nem acessa producao. Ela usa somente uma imagem
efemera no CI, com rede desabilitada durante o probe final.

Antes de disponibilizar a imagem ao runner Ubuntu, e necessario um processo
aprovado que publique a imagem em registry, preserve sua proveniencia e permita
ao operador obter o mesmo `repositorio@sha256` em `RepoDigests`. Essa decisao
nao esta implementada nesta PR.

Ao liberar as Actions, o checkout deve usar SHA completo revisado e
`persist-credentials: false`; a etapa que instala Node/pnpm tambem deve usar
SHA completo revisado. Nenhum token do workflow pode ser montado no container
de qualificacao.
