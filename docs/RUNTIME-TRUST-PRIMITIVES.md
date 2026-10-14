# Primitivas isoladas de confiança do runtime

Este módulo fornece contratos e testes sintéticos locais para futuros controles
de publicação do runtime. Ele **não** é um gateway operacional, não protege
contra um operador com privilégios de `root` e não autoriza publicação,
backup, alteração de Compose ou acesso a produção.

## Escopo do PR 1

- `server/runtime-trust/strict-json.ts`: parser UTF-8 estrito, rejeição de
  chaves duplicadas/BOM, limites explícitos e canonicalização baseada em JCS.
- `server/runtime-trust/attestation.ts`: envelopes fechados e versionados,
  assinatura Ed25519 e uma `TrustPolicy` fornecida pelo chamador.
- `server/runtime-trust/claims.ts`: claim local de uso único exclusivamente
  para testes sintéticos, criada com `open(..., "wx")`, releitura e checksum.
- `server/runtime-trust/synthetic-journal.ts`: cadeia checksummed de eventos
  sintéticos, destinada somente a fixtures do contrato de recibo. O módulo
  exporta contratos de dados, mas não exporta validador estrutural.

Nada neste diretório contém trust root de produção, chave privada, host,
caminho operacional, segredo, Compose, workflow ou chamada de rede.

## Parser, schemas, canonicalização e assinatura

O parser apenas aceita bytes UTF-8 de JSON não ambíguo: rejeita BOM, chaves
duplicadas, UTF-8/escapes inválidos, truncamento e os limites configurados de
tamanho, profundidade, chaves e strings. Ele **não** rejeita campos
desconhecidos por si só: essa responsabilidade pertence a cada schema fechado.

Todo UUID que identifica atestação, autorização, receipt, evidência temporal,
journal ou claim deve estar na representação canônica ASCII em minúsculas.
Entradas maiúsculas, mistas ou malformadas são rejeitadas; a biblioteca nunca
normaliza identificadores recebidos silenciosamente. Assim, uma mesma
identidade não pode entrar como textos distintos nas fronteiras de receipt,
journal e claim.

O envelope atual é `megadesk-runtime-trust-signed-envelope/v3`. Seus bytes
assinados são exatamente a codificação UTF-8 JCS de:

```json
{"payload": <payload-fechado>, "protected": <cabeçalho-fechado>}
```

O cabeçalho protegido contém o domínio fixo `megadesk-runtime-trust/v3`, a
versão do protocolo, o tipo do envelope, `keyId`, a finalidade e o SHA-256 JCS
do payload. A assinatura repete o `keyId` em formato fechado
(`algorithm`, `encoding`, `keyId`, `value`); qualquer divergência é rejeitada.
Portanto uma assinatura v3 não é
reutilizável em outro domínio, versão, tipo ou finalidade. Envelopes v1 não
são interpretados como v3; a incompatibilidade é intencional.

Os testes cobrem exemplos de ordenação de propriedades e serialização numérica
de RFC 8785, igualdade exata de bytes UTF-8, limites exatos, Unicode, `-0`,
expoentes e valores fora do perfil. Esta cobertura é uma evidência para os
vetores incluídos; **não constitui certificação completa de RFC 8785**. O corpus
oficial não está versionado localmente e não foi baixado. Antes de alegar
conformidade integral, a integração deverá adicionar uma referência imutável à
origem e versão do corpus, incorporá-lo por revisão separada e executar seus
vetores sem alteração.

## Trust policy, autorização atual e recibo histórico

`TrustPolicy` é deliberadamente abstrata. A aplicação deve receber a política
de uma fonte independente e autenticada; um hash lido apenas do host não é
evidência suficiente. A verificação falha fechada quando:

- a fonte de revogação está indisponível;
- `keyId`, finalidade, chave pública, digest, status ou intervalo de validade
  não correspondem;
- o escopo, o payload, a assinatura ou a janela de validade divergem.

`verifySignedEnvelopeBytes` é exclusivamente para autorização operacional
atual: exige chave ativa, não expirada, revogação disponível e validade atual
do payload. `verifyHistoricalReceiptEnvelopeBytes` é uma API distinta para
receipts: exige bytes de evidência temporal assinada por uma
`TimeAuthorityPolicy` distinta. A comparação é feita sobre o SPKI/DER da chave
pública, não sobre `keyId` ou a grafia do PEM: uma chave de receipt não pode
assinar sua própria evidência temporal. A evidência fechada vincula o SHA-256
dos bytes exatos do receipt, hashes das policies/revogações, `keyId`, finalidade
e validade. Tanto `signedAt` quanto `issuedAt` devem estar na vigência da chave
da autoridade temporal; o campo assinado `issuedAt` é autenticado, mas não é
uma autoridade de tempo por si só.

Um receipt de chave rotacionada pode ser verificado após a expiração somente se
a evidência externa mostrar que a assinatura ocorreu durante a validade da
chave. Chave revogada falha por padrão. A única exceção modelada requer política
explícita, motivo `superseded` e prova de assinatura anterior à revogação;
revogação por comprometimento nunca é aceita automaticamente. A origem,
assinatura, retenção, rotação e revogação da policy temporal continuam decisões
humanas e operacionais pendentes. Sem autoridade temporal configurada, a API
histórica falha fechada.

A política não implementa descoberta de chaves, rotação, revogação distribuída
ou política de relógio. Essas decisões exigem autoridade humana antes de uma
integração operacional:

1. autoridade que emite, revoga e rotaciona chaves;
2. formato, transporte autenticado, versão e retenção do trust set/revogações;
3. tolerância de relógio, monitoramento de NTP e reação a relógio inválido;
4. processo independente que vincula o orquestrador de backup ao commit,
   artefato e SHA-256 aprovados.

## Uso único, filesystem e recuperação

Claims usam lease exclusivo, arquivo de estágio sincronizado e publicação sem
substituição por hard link. Há estados explícitos `absent`, `in-progress`,
`consumed`, `corrupt` e `durability-unconfirmed`. Uma falha após criar a lease,
o estágio ou a publicação nunca libera automaticamente a autorização. Arquivo
parcial/corrompido não é aceito como consumido; requer recuperação independente
futura. Durante a curta janela entre hard link e remoção do estágio, leitores
veem `in-progress`, não um JSON incompleto.

O módulo exige raiz previamente provisionada, privada e de propriedade do UID
executor. Ele rejeita symlinks nos componentes existentes, valida a identidade
da raiz no preflight/pós-publicação e verifica tipo regular e hard links. Isso
**não elimina TOCTOU** contra um agente capaz de alterar a raiz ou seus pais:
Node não fornece `openat`/`O_NOFOLLOW` portátil para toda a árvore. A integração
operacional deve demonstrar que a raiz e os pais são controlados; caso contrário,
falha fechada. Windows é explicitamente não suportado para claims por falta de
verificação suficiente de reparse points, ACL e durabilidade de diretório.
`fsync` de arquivo ou diretório inconclusivo nunca retorna uma claim
autorizadora; não existe bypass público de teste.

Uma integração de produção precisa de lease/gateway comum, armazenamento
durável aprovado, recuperação assinada e inventário completo dos escritores.
`flock` isolado ou uma claim local não bastam se operadores, timers, updater ou
automação externa puderem escrever fora desse protocolo.

## Journal sintético e vínculo de receipt

O journal possui identidade de receipt/operação/autorização, sequência estrita,
hash do evento anterior e checksum do journal completo. O receipt v1 carrega
`journal.kind`, `journal.version`, os três identificadores e o SHA-256 JCS do
**objeto final inteiro do journal**, inclusive seu checksum de cadeia. O journal
nunca inclui a assinatura do receipt, portanto não há referência circular.
`verifyHistoricalReceiptJournalBytes` recebe os bytes do envelope, policy e
evidência temporal e somente então deriva payload imutável para verificar
contexto e digest. A validação estrutural do journal é privada a esse caminho:
não existe API pública que aceite journal bruto e o associe a uma promoção, um
receipt ou autenticidade histórica. `SyntheticJournal` é somente um contrato
de fixture; sua presença não é prova criptográfica.

O hash encadeado sozinho não impede que um agente reescreva todo o histórico e
recalcule seus hashes. O vínculo só fornece a garantia correspondente se a
assinatura do receipt e sua evidência temporal externa forem verificadas por
uma autoridade confiável. Isto ainda não é um recibo operacional: faltam
autoridade de assinatura, armazenamento durável independente do Compose,
retenção, segunda cópia, ACLs e recuperação auditada.

O futuro `megadesk-app-runtime-promotion-receipt/v1` deve separar executor e
autoridade de assinatura, vincular Compose anterior, runtime anterior/candidato
e backup consistente, e rejeitar persistência indisponível antes de qualquer
recriação de `app`.

## Limites de segurança explícitos

- Os testes usam chaves Ed25519 efêmeras em memória; não criam nem exportam
  chave privada persistente.
- O diretório de claim usado nos testes é temporário e sintético.
- Não há banco, Docker, SSH, Compose, rede ou migração nesta biblioteca/testes.
- A implementação futura precisa de revisão de segurança independente e de
  validação em ambiente isolado antes de receber autoridade operacional.
