# Contingência da integração WhatsApp / Evolution

## Objetivo

Uma indisponibilidade da Evolution, do webhook ou do WhatsApp não deve apagar a sessão local, provocar logout automático nem ficar invisível para o operador.

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
