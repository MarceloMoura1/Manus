# Mídia privada de produtos

Este documento descreve o runtime Product Media versionado no MegaDesk. Ele não comprova implantação em produção nem aplicação da migration 0016 no banco main.

## Contrato HTTP

Os três endpoints exigem uma sessão operacional válida. O tenant e o usuário são obtidos da sessão no servidor; o cliente não informa `client_id` para autorização. Todas as consultas e alterações vinculam produto, mídia e `client_id`.

### `PUT /api/products/:productId/image`

- Exige papel `admin` ou `manager`.
- `:productId` e o header `x-client-attempt-id` devem ser UUIDs v4.
- Recebe os bytes da imagem diretamente no corpo, não JSON, multipart ou base64.
- O parser aceita `image/jpeg`, `image/png`, `image/webp` e `application/octet-stream`; o conteúdo real ainda precisa ser uma imagem JPEG, PNG ou WebP estática válida.
- O limite do corpo é 5 MiB. A imagem também é rejeitada se exceder 10.000 pixels em qualquer dimensão ou 40.000.000 de pixels no total.
- Sucesso retorna HTTP 200 com `{ "mediaId": "..." }`.
- Repetir o mesmo attempt ID, para o mesmo produto e conteúdo normalizado, é idempotente. Reutilizá-lo para outro produto ou conteúdo retorna conflito.
- Erros relevantes incluem 400 para requisição ou imagem inválida, 401 sem sessão, 403 sem permissão, 404 para produto inexistente, 409 para conflito e 413 para corpo acima do limite.

### `GET /api/products/:productId/image`

- Exige sessão válida e só retorna a mídia primária `active` do produto no mesmo tenant.
- `?variant=thumbnail` seleciona o thumbnail; qualquer outro valor retorna a imagem principal normalizada.
- Sucesso retorna os bytes WebP inline, sem redirect ou URL pública, com `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff` e `Cache-Control: private, max-age=300`.
- Produto sem mídia ativa, referência de outro tenant ou arquivo não encontrado retorna resposta sanitizada; a ausência lógica de imagem retorna 404.
- Nenhum caminho físico ou storage key é exposto ao cliente.

### `DELETE /api/products/:productId/image`

- Exige papel `admin` ou `manager` e UUID v4 válido.
- Remove a referência primária do produto e muda a mídia ativa para `pending_delete`. A remoção física fica a cargo de `reconcile()`.
- É idempotente quando o produto existe e já não tem mídia: retorna HTTP 200 com `{ "ok": true }`.

## Storage e processamento

- A raiz vem de `MEGADESK_MEDIA_ROOT`, que deve ser absoluta. Fora de testes, na ausência dessa variável, o runtime usa `%LOCALAPPDATA%\MegaDesk\media`; sem uma das duas opções, falha fechado.
- Em testes, `MEGADESK_MEDIA_ROOT` e `MEGADESK_MEDIA_TEST_RUN_ID` são obrigatórios. A raiz deve existir, pertencer nominalmente à execução, ser diretório e não ser link simbólico.
- O runtime grava somente chaves opacas no formato `objects/<shard>/<uuid>.webp` e `thumbnails/<shard>/<uuid>.webp`. Caminhos enviados pelo usuário não são aceitos.
- JPEG, PNG e WebP estáticos são lidos pelo Sharp. Orientação é aplicada antes do resize; animações, SVG, bytes incompatíveis e imagens inválidas são rejeitados.
- A imagem principal é re-encodada como WebP, qualidade 84, limitada a 1600 × 1600 com `fit: inside` e sem ampliação.
- O thumbnail é re-encodado como WebP, qualidade 76, em 320 × 320 com `fit: cover`.
- O output é reconstruído pelo Sharp sem opção de preservação de metadata. O banco registra MIME WebP, tamanho da imagem principal, SHA-256, largura e altura normalizadas.
- Cada arquivo é escrito em temporário exclusivo com modo `0600`, sincronizado e renomeado para o destino. Essa atomicidade é por arquivo; ela não torna filesystem e MySQL uma única transação distribuída.
- A raiz é privada: não deve ficar em diretório público, ser servida estaticamente ou ser exposta por CDN/URL permanente.

## Banco e lifecycle

A migration 0016 adiciona `erp_product_media` e `erp_products.primary_media_id`. As FKs compostas incluem `client_id` e asseguram que a mídia primária pertença ao mesmo produto e tenant. Há unicidade tenant-scoped para media ID e attempt ID, chaves de storage globais únicas e no máximo uma mídia `active` por produto.

Estados persistidos:

- `staged`: metadados registrados, ainda não ativados;
- `active`: mídia primária atual do produto;
- `pending_delete`: mídia substituída ou removida logicamente, aguardando reconciliação;
- `deleted`: remoção física concluída e registrada.

No upload, uma primeira transação registra ou recupera o `staged` idempotente. Depois, sob locks, o runtime grava imagem e thumbnail, marca a mídia primária anterior como `pending_delete`, aponta o produto para a nova mídia e muda a nova mídia para `active`.

No replace, uma nova mídia e novas chaves opacas são criadas; os arquivos anteriores não são sobrescritos. No remove, a referência do produto é anulada antes de a mídia anterior entrar em `pending_delete`.

`pending_delete` e `deleted` não são reativáveis pelo fluxo publicado. Uma tentativa que já saiu de `staged` e não está `active` é rejeitada.

## Reconcile, concorrência e recovery

`ProductMediaService.reconcile(graceMs, limit)` existe no runtime, com defaults de 24 horas e 100 itens. O runtime limita o grace period entre -60 segundos e 30 dias e o lote entre 1 e 500. Ele considera apenas registros `staged` ou `pending_delete` antigos o suficiente e sem referência primária no snapshot de candidatos.

Para cada candidato, a ordem global é:

1. iniciar transação;
2. obter lock do produto por `id + client_id`;
3. revalidar a referência primária;
4. obter lock da mídia por `id + client_id` e revalidar estado, idade e tenant;
5. remover imagem e thumbnail com `rm(..., { force: true })` ainda dentro da transação;
6. mudar o estado para `deleted`;
7. commit.

Essa ordem produto → mídia é a mesma usada na ativação. A revalidação sob lock impede apagar uma mídia que voltou a ser a referência primária. Se o reconciliador obtiver o claim primeiro, uma ativação concorrente espera e depois rejeita o estado `deleted`. Dois reconcilers são serializados pelos locks; apenas um marca e contabiliza a exclusão.

A mídia só é marcada `deleted` depois que as duas remoções retornam com sucesso. Falha de filesystem causa rollback da transação, preservando o estado lógico anterior para retry. Como `rm(force)` aceita arquivo já ausente, o retry converge quando uma tentativa anterior removeu um arquivo mas falhou ou perdeu a conexão antes do commit.

Não existe atomicidade distribuída entre MySQL e filesystem, garantia exactly-once ou promessa de zero data loss. Há uma janela residual de crash entre remoção física e commit: o banco pode continuar em `staged`/`pending_delete` enquanto um ou ambos os arquivos já não existem. O retry é seguro para a remoção, mas não recria bytes ausentes.

O reconciliador atual ignora um candidato se o produto associado não puder ser localizado sob lock ou se ele ainda referenciar a mídia. Essa condição deve ser observada operacionalmente; não há coleta genérica de arquivos órfãos fora das referências conhecidas.

## Agendamento e implantação

Não há scheduler, cron ou job publicado que invoque `reconcile()` automaticamente. O método está disponível no runtime, mas seu acionamento periódico, observabilidade e política de grace period ainda precisam ser configurados ou implementados operacionalmente. Deploy, rollback e migration não executam reconciliação.

O modelo atual usa filesystem local. A implantação deve:

- configurar e validar `MEGADESK_MEDIA_ROOT` antes de liberar tráfego;
- provisionar diretório persistente fora de storage efêmero, com permissões restritas à conta da aplicação;
- monitorar disponibilidade, erros de I/O, capacidade e espaço livre;
- executar reconciliação somente por integração operacional explicitamente controlada;
- manter o diretório privado e nunca montá-lo como conteúdo web público.

O runtime não estabelece coordenação de filesystem entre hosts. Portanto, não se deve declarar suporte seguro a múltiplas instâncias com discos locais independentes. Até existir uma topologia compartilhada e validada, assuma uma única visão persistente e coerente de `MEGADESK_MEDIA_ROOT`.

## Backup e restore

Backup/restore não são implementados por este módulo. Operacionalmente, banco e árvore de mídia devem compor o mesmo ponto lógico de recuperação; writes precisam ser pausados ou coordenados durante a captura. Preserve as chaves relativas de `objects/` e `thumbnails/` e nunca publique caminhos absolutos ou credenciais.

Um restore deve ser validado em ambiente descartável e isolado, conferindo referências tenant-scoped, arquivos, tamanhos e hashes antes de promoção. Restaurar somente o banco ou somente a árvore pode produzir referências sem arquivo ou arquivos sem referência. Essas recomendações não constituem garantia de backup consistente, automática ou sem perda.

## Segurança

- O acesso aos bytes ocorre exclusivamente pelo endpoint autenticado.
- Não servir `MEGADESK_MEDIA_ROOT` estaticamente.
- Não expor caminhos físicos, storage keys ou URLs públicas permanentes.
- Não confiar em tenant/client ID enviado pelo browser.
- Não persistir imagens grandes como base64 no banco.
- Logs e monitoramento devem evitar nomes de arquivo, paths físicos e dados pessoais.

## Evidência validada

As validações aprovadas foram executadas com fixtures sintéticas e, quando aplicável, MySQL descartável; não usaram o banco main:

- unitários Product Media: 12 passed;
- contrato HTTP: 6 passed;
- estrutura: 5 passed;
- MySQL físico: 8 passed, 0 failed, 0 deadlocks;
- suíte global: 1265 passed, 0 failed, 388 skips condicionais;
- UI/E2E Chromium: 13 passed, 0 failed.

## Estado de entrega

Product Media, migration 0016, runtime e UI/E2E estão implementados e versionados no branch correspondente. Este estado de código não prova que a migration foi aplicada no main ou em produção, nem que o recurso esteja implantado ou habilitado em produção.
