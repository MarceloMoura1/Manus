# Contingência da integração WhatsApp / Evolution

## Objetivo

Uma indisponibilidade da Evolution, do webhook ou do WhatsApp não deve apagar a sessão local, provocar logout automático nem ficar invisível para o operador.

Baseline funcional: `c0e0f33e625eb1d76d6d84129f80eb44cd6d408b`.

Backup Evolution verificado: `evolution-20260827-215910`. Integridade do manifesto
SHA-256: `1F35F3483C9F8EB9CD8C6FEAC94769B288498D83AA10C368B9C62E13E4A350D3`.
O backup é externo ao repositório; conteúdo, caminhos e dados restaurados não são
expostos pela aplicação.

## Matriz de primeira resposta

| Sintoma | Evidência | Causa provável | Primeira ação segura | Ação proibida inicialmente |
| ------- | --------- | -------------- | -------------------- | -------------------------- |
| Sessão MegaDesk inválida | HTTP 401 / `UNAUTHORIZED` | Cookie ausente ou expirado | Logout, recarga forçada e novo login | Enfraquecer autenticação ou Repair |
| URL tRPC incorreta | Mutation destinada ao host do app | Base relativa em produção | Confirmar URL canônica da API | Alterar tenant ou cookie no navegador |
| Evolution indisponível | Provedor sem resposta no diagnóstico | Serviço ou rede indisponível | Coletar diagnóstico read-only | QR, logout ou recriação |
| Instância desconectada | Estado confirmado `disconnected` | Vínculo encerrado | Ir para o fluxo normal Conectar | Repair repetido ou exclusão |
| QR necessário | Estado confirmado `qr_required` | Novo vínculo exigido | Abrir a conexão WhatsApp | Gerar QR por polling global |
| Webhook degradado | URL, segredo ou eventos divergentes | Configuração incompleta | Diagnosticar e usar Repair uma vez | Logout ou apagar instância |
| Erro de identificador do provedor | Categoria recorrente atinge 3 eventos na janela observada | Incompatibilidade do provedor | Preservar cache local desativado e acompanhar impacto | Converter identificador em telefone |
| HTTP 2xx sem `key.id` | Aceite outbound incompleto | Resposta inválida do provedor | Tratar como falha e preservar texto | Persistir ou anunciar sucesso |
| Recebimento funciona, envio falha | Webhook recebe e outbound não confirma | Resolução, auth ou aceite outbound | Diagnosticar a camada exata | Enviar novamente automaticamente |
| Envio funciona, recebimento falha | `key.id` presente e webhook sem eventos | Webhook degradado | Diagnosticar webhook e usar Repair se indicado | Logout inicial |
| MegaAdmin indisponível | Admin público sem HTTP 200 | Node, tunnel ou rota indisponível | Usar Diagnosticar MegaDesk | Iniciar componentes sem identificar estado |
| Docker Desktop fechado | Engine inacessível no relatório | Docker não iniciado | Abrir Docker Desktop manualmente e revalidar | Recriar containers ou volumes |

Limites deterministas: três falhas consecutivas de webhook tornam a integração
degradada; três erros recorrentes da categoria de identificador tornam o tenant
degradado; restart count igual ou superior a três é tratado como restart loop.
Um warning Prisma isolado é apenas atenção. Esses estados são avaliados por tenant;
um tenant não degrada outro. Backup não verificável gera atenção, não indisponibilidade.

## Estados operacionais

- **Conectado e saudável**: Evolution acessível, instância `open` e webhook completo.
- **Conectado e degradado**: o banco preserva a última sessão conectada, mas a Evolution está temporariamente inacessível. Não desconectar nem limpar a sessão.
- **Webhook degradado**: Evolution acessível, porém URL, segredo ou eventos não correspondem ao esperado. Usar **Reparar integração**.
- **Desconectado**: Evolution respondeu e confirmou que a instância não está aberta. Gerar QR Code.

## Recuperação segura

1. Consultar o diagnóstico exibido na página do WhatsApp.
2. Usar **Reparar integração**. Essa ação consulta a instância, reconfigura o webhook e atualiza o estado local sem logout.
3. Se a Evolution confirmar `disconnected`, gerar e escanear um novo QR Code.
4. Usar **Desconectar WhatsApp** somente quando a intenção for remover o dispositivo vinculado. A operação exige perfil administrativo, confirmação explícita e gera auditoria.

## Proteções implementadas

- reconexão idempotente para instância já existente;
- preservação da sessão local quando o provedor está fora do ar;
- health check funcional de API, status e configuração do webhook;
- reparo manual e idempotente do webhook, sem efeitos colaterais nas consultas de status;
- reparo não destrutivo;
- logout restrito a `admin`/`manager`, com confirmação e auditoria;
- cache local da Evolution desativado no Compose devido à incompatibilidade `lid`/Prisma da versão 2.3.7;
- testes de regressão para autorização, confirmação, preservação de sessão e reparo.

O webhook é o caminho de entrada de mensagens. Não existe fallback de polling de
mensagens implementado; o polling existente consulta somente o estado da conexão.
Backoff coordenado, alertas persistentes e fallback de mensagens permanecem como
melhorias futuras e não são anunciados como proteção operacional atual.

## Aplicação da configuração Docker

A alteração de `CACHE_LOCAL_ENABLED` só entra em vigor quando o container Evolution for recriado por uma operação planejada. Antes disso:

1. confirmar backup verificável do banco e dos volumes da Evolution;
2. escolher janela de manutenção;
3. recriar apenas os serviços definidos em `docker-compose.evolution.yml`, sem remover volumes;
4. validar health check, instância, QR e webhook;
5. nunca usar `docker compose down -v`.

## Evidências mínimas após manutenção

- containers `megadesk-evolution` e `megadesk-evolution-db` saudáveis;
- `/instance/fetchInstances` acessível;
- health da aplicação com `providerReachable=true` e `webhookHealthy=true`;
- evento diagnóstico autenticado respondendo HTTP 200;
- envio e recebimento reais confirmados em conversa controlada.
