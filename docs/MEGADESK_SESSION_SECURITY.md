# Segurança da sessão operacional do MegaDesk

## Escopo

Esta camada autentica usuários operacionais do MegaDesk. Ela é independente da sessão do MegaAdmin e não altera a arquitetura oficial de isolamento lógico por tenant. A implementação não autoriza nem inicia o módulo ERP.

## Modelo de autenticação

O login exige somente e-mail e senha. A resposta de erro é uniforme, reduzindo enumeração de contas. O servidor considera apenas usuários e tenants ativos com acesso liberado, valida as senhas no backend e aceita o login somente quando há uma única correspondência. Se a mesma combinação de e-mail e senha existir em mais de um tenant, o acesso é recusado em vez de escolher uma empresa implicitamente.

Após o login, o navegador recebe `megadesk_session`, um token aleatório opaco de 256 bits. O valor bruto existe apenas no cookie e somente seu hash SHA-256 é persistido em `megadesk_operational_sessions`. O cookie usa `HttpOnly`, `SameSite=Lax`, `Path=/` e `Secure` em produção ou HTTPS. A duração padrão é de oito horas e pode ser configurada entre 1 e 720 horas por `MEGADESK_SESSION_TTL_HOURS`.

O estado salvo em `localStorage` contém somente informações públicas de apresentação. Ele não autentica chamadas. A cada requisição, o backend resolve do banco a sessão, o tenant, o usuário, o papel e as permissões atuais. Cabeçalhos legados `x-tenant-id`, `x-user-email` e `x-user-role` são opcionais; quando presentes, precisam coincidir com a sessão e nunca substituem o cookie.

Um novo login revoga sessões ativas anteriores da mesma identidade e cria um token novo. Logout revoga o hash no banco e limpa o cookie. Sessões expiradas ou revogadas, usuários bloqueados e tenants pausados ou sem acesso liberado falham de forma fechada.

## CSRF e origem

Mutações operacionais validam `Origin` ou, na ausência dele, a origem de `Referer`. Em produção, `MEGADESK_ALLOWED_ORIGINS` deve listar as origens HTTPS autorizadas, separadas por vírgula. Sem origem autorizada, a mutação é rejeitada. O login e o logout aplicam a mesma proteção.

Exemplo sem credenciais:

```text
MEGADESK_ALLOWED_ORIGINS=https://app.exemplo.com
MEGADESK_SESSION_TTL_HOURS=8
TRUST_PROXY_HOPS=1
```

`TRUST_PROXY_HOPS` só deve ser definido quando a aplicação estiver atrás de uma quantidade conhecida de proxies confiáveis. Isso permite que o Express reconheça HTTPS sem confiar indiscriminadamente em cabeçalhos encaminhados.

## Socket.IO e WhatsApp

O handshake do Socket.IO exige o mesmo cookie válido. O servidor coloca o socket apenas na sala derivada do tenant autenticado. Uma tentativa de escolher outro tenant desconecta o socket. Atualizações de status de mensagens também são emitidas somente para a sala do tenant, evitando broadcast entre clientes. Webhooks externos permanecem independentes desta sessão.

## Banco e implantação

A migration adiciona somente `megadesk_operational_sessions`, com índices para hash, usuário, tenant e expiração. Ela deve ser revisada e aplicada pelo fluxo canônico descrito em `docs/MIGRATIONS.md`; gerar o arquivo não aplica a migration. Antes de publicar o backend que exige cookies, configure a origem permitida, o proxy confiável quando aplicável, aplique a migration em homologação e valide login, revogação, expiração, bloqueio de usuário, pausa de tenant, CSRF e Socket.IO.

Tokens, hashes, senhas, cookies e conteúdo de mensagens não devem ser registrados em logs.
