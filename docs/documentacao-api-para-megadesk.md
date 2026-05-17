# Documentação da API MegaAdmin ↔ MegaDesk

**Autor:** Manus AI  
**Base de produção:** `https://megadeskadm-kqwgiavj.manus.space`  
**Objetivo:** permitir que a plataforma **MegaDesk** use o **MegaAdmin** como fonte de verdade para cadastro de clientes, usuários, permissões, liberação de acesso, tokens de API e dados operacionais.

## 1. Visão geral da integração

A integração deve funcionar com o **MegaAdmin como autoridade administrativa** e a **MegaDesk como plataforma operacional**. Isso significa que nenhum usuário deve conseguir acessar a MegaDesk se o cliente não estiver previamente cadastrado e liberado no MegaAdmin. O MegaAdmin controla o cliente, o plano, o limite de usuários, o status, a liberação de acesso, os usuários, as permissões e os tokens de API. A MegaDesk consulta essa autoridade no momento do login e usa a resposta para montar a sessão interna.

| Responsabilidade | MegaAdmin | MegaDesk |
|---|---|---|
| Cadastro da empresa | Cadastra cliente, plano, status e limite de usuários. | Não deve criar acesso independente sem validação no Admin. |
| Liberação de acesso | Define se o cliente está ativo e com `accessReleased=true`. | Só permite login quando receber autorização do Admin. |
| Usuários e permissões | Mantém usuários, cargos, status e módulos permitidos. | Aplica a interface e os módulos conforme `user.permissions`. |
| Tokens de API | Gera automaticamente o token inicial no cadastro e permite renovar, rotacionar e revogar tokens por cliente. | Configura o token inicial recebido no ambiente/serviço correspondente. |
| Login | Valida cliente, token, usuário, senha, status e permissões. | Chama o endpoint de validação antes de criar sessão. |
| Dados operacionais | Recebe e consulta registros por cliente, tenant e telefone. | Envia ou consulta rastreios, ERP, conversas e chamados. |

## 2. Autenticação da API

Todas as chamadas da MegaDesk para endpoints de integração devem usar um **token de API ativo do cliente**. O primeiro token é gerado automaticamente assim que o cliente é cadastrado no MegaAdmin e aparece uma única vez no painel pós-cadastro para cópia/configuração na MegaDesk. O token pode ser enviado pelo header `Authorization` ou pelo header alternativo `x-megadesk-api-token`.

| Header | Formato |
|---|---|
| `Authorization` | `Bearer <TOKEN_DO_CLIENTE>` |
| `x-megadesk-api-token` | `<TOKEN_DO_CLIENTE>` |
| `Content-Type` | `application/json` para requisições com corpo |

> O token é por cliente. Se a MegaDesk operar múltiplos clientes, cada cliente deve ter seu próprio `clientId` e seu próprio token configurado.

## 3. Variáveis necessárias na MegaDesk

A equipe MegaDesk precisa configurar as variáveis abaixo no ambiente da aplicação ou no serviço responsável pelo login integrado.

| Variável | Obrigatória | Valor esperado | Finalidade |
|---|---:|---|---|
| `MEGAADMIN_API_BASE_URL` | Sim | `https://megadeskadm-kqwgiavj.manus.space` | URL base do MegaAdmin em produção. |
| `MEGAADMIN_CLIENT_ID` | Sim | ID numérico do cliente no Admin, por exemplo `77` | Identifica o tenant/cliente que está tentando acessar. |
| `MEGAADMIN_API_TOKEN` | Sim | Token inicial gerado automaticamente no cadastro do cliente no MegaAdmin | Autoriza a MegaDesk a consultar dados desse cliente. |
| `MEGAADMIN_AUTH_VALIDATE_PATH` | Opcional | `/api/megadesk/integration/auth/validate` | Permite customizar o caminho do endpoint de login. |

## 4. Endpoint obrigatório de login integrado

A MegaDesk deve chamar este endpoint sempre que um usuário tentar fazer login. O login só deve ser concluído quando a resposta vier com `success=true` e `allowed=true`.

| Campo | Valor |
|---|---|
| Método | `POST` |
| Endpoint | `/api/megadesk/integration/auth/validate` |
| URL completa | `https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/auth/validate` |
| Autenticação | `Authorization: Bearer <TOKEN_DO_CLIENTE>` |
| Corpo | JSON com `clientId`, `email` e `password` |

### 4.1 Payload de requisição

```json
{
  "clientId": 77,
  "email": "usuario@cliente.com",
  "password": "senha-digitada-na-megadesk"
}
```

### 4.2 Resposta de sucesso

```json
{
  "success": true,
  "allowed": true,
  "sourceOfTruth": "MegaAdmin",
  "client": {
    "id": 77,
    "name": "Cliente Exemplo",
    "tenantDatabaseName": "megadesk_cliente_exemplo_ab12cd34",
    "status": "active",
    "accessReleased": true,
    "plan": "Profissional",
    "maxUsers": 10,
    "modules": [
      "Atendimento Ativo",
      "Conversas",
      "Chamados",
      "Rastreamento",
      "ERP",
      "Configurações",
      "Configurar BOT",
      "Assistente IA"
    ]
  },
  "user": {
    "id": 12,
    "clientId": 77,
    "clientName": "Cliente Exemplo",
    "tenantDatabaseName": "megadesk_cliente_exemplo_ab12cd34",
    "phone": "+55 11 99999-9999",
    "phoneNormalized": "5511999999999",
    "name": "Usuário Exemplo",
    "email": "usuario@cliente.com",
    "role": "agent",
    "status": "active",
    "permissions": ["Conversas", "Chamados"]
  },
  "sessionToken": "token-assinado-pelo-megaadmin"
}
```

A MegaDesk deve usar `client.tenantDatabaseName` para isolar o tenant, `user.role` para definir o nível de atuação e `user.permissions` para liberar ou esconder módulos da interface. O campo `sessionToken` pode ser armazenado como referência emitida pelo MegaAdmin, mas a MegaDesk pode criar sua própria sessão interna depois de receber `allowed=true`.

### 4.3 Respostas de bloqueio

| HTTP | Situação | Como a MegaDesk deve tratar |
|---:|---|---|
| `400` | `clientId`, `email` ou `password` ausente/inválido. | Mostrar erro de formulário e não criar sessão. |
| `401` | Token ausente/inválido ou usuário/senha inválidos. | Mostrar mensagem genérica de credenciais inválidas. |
| `403` | Cliente pausado, acesso não liberado ou usuário inativo. | Informar que o acesso depende de liberação administrativa. |
| `404` | Cliente não existe no MegaAdmin. | Bloquear login e revisar cadastro do cliente no Admin. |
| `500` | Falha inesperada no MegaAdmin. | Exibir indisponibilidade temporária e registrar tentativa. |

### 4.4 Exemplo de implementação na MegaDesk

```ts
async function validateLoginWithMegaAdmin(input: { email: string; password: string }) {
  const response = await fetch(
    `${process.env.MEGAADMIN_API_BASE_URL}/api/megadesk/integration/auth/validate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.MEGAADMIN_API_TOKEN}`,
      },
      body: JSON.stringify({
        clientId: Number(process.env.MEGAADMIN_CLIENT_ID),
        email: input.email,
        password: input.password,
      }),
    }
  );

  const result = await response.json();

  if (!response.ok || !result.success || !result.allowed) {
    throw new Error(result.error || "Login não autorizado pelo MegaAdmin");
  }

  return result;
}
```

## 5. Endpoint de saúde da integração

Este endpoint serve para confirmar se o token e o cliente estão válidos antes dos testes de login ou durante diagnóstico operacional.

| Campo | Valor |
|---|---|
| Método | `GET` |
| Endpoint | `/api/megadesk/integration/health?clientId=77` |
| URL completa | `https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/health?clientId=77` |
| Autenticação | `Authorization: Bearer <TOKEN_DO_CLIENTE>` |

```bash
curl "https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/health?clientId=77" \
  -H "Authorization: Bearer TOKEN_DO_CLIENTE"
```

## 6. Endpoints de dados operacionais

Além do login integrado, a MegaDesk pode enviar e consultar dados operacionais do cliente, como rastreios, ERP, conversas e chamados. Esses dados devem sempre carregar `clientId` e `ownerPhone`, garantindo isolamento por cliente e por telefone do cliente final.

| Método | Endpoint | Uso |
|---|---|---|
| `POST` | `/api/megadesk/integration/operational-data` | Enviar dados operacionais da MegaDesk para o MegaAdmin. |
| `GET` | `/api/megadesk/integration/operational-data?clientId=77&ownerPhone=5511999999999` | Consultar registros isolados por cliente e telefone. |

### 6.1 Enviar dados operacionais

```bash
curl -X POST "https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/operational-data" \
  -H "Authorization: Bearer TOKEN_DO_CLIENTE" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": 77,
    "recordType": "tracking",
    "ownerPhone": "+55 11 99999-9999",
    "ownerLogin": "cliente@exemplo.com",
    "externalId": "TRACK-001",
    "title": "Pedido #1001 em transporte",
    "status": "in_transit",
    "payload": {
      "trackingCode": "BR123456789",
      "carrier": "Correios",
      "lastEvent": "Objeto em trânsito"
    }
  }'
```

| Campo | Obrigatório | Descrição |
|---|---:|---|
| `clientId` | Sim | ID do cliente no MegaAdmin. |
| `recordType` | Sim | Tipo do registro: `tracking`, `erp`, `conversation` ou `ticket`. |
| `ownerPhone` | Sim | Telefone do cliente final, usado para isolamento dos dados. |
| `ownerLogin` | Não | Login/e-mail complementar do cliente final. |
| `externalId` | Não | ID externo do registro na MegaDesk. |
| `title` | Sim | Título curto do registro. |
| `status` | Sim | Status operacional do registro. |
| `payload` | Não | Objeto JSON com detalhes específicos do módulo. |

### 6.2 Consultar dados operacionais

```bash
curl "https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/operational-data?clientId=77&ownerPhone=5511999999999&recordType=ticket" \
  -H "x-megadesk-api-token: TOKEN_DO_CLIENTE"
```

Resposta esperada:

```json
{
  "success": true,
  "records": [
    {
      "id": 10,
      "clientId": 77,
      "recordType": "ticket",
      "ownerPhoneNormalized": "5511999999999",
      "title": "Chamado #2048",
      "status": "open"
    }
  ]
}
```

## 7. Checklist para iniciar os testes

| Etapa | Responsável | Resultado esperado |
|---|---|---|
| Criar cliente no MegaAdmin | Admin | Cliente aparece no painel com status `active` ou pronto para ativação. |
| Liberar acesso do cliente | Admin | Campo `accessReleased=true`. |
| Abrir painel do cliente | Admin | O painel pós-cadastro exibe **Resumo do cliente**, **Credenciais de integração** e o token inicial. |
| Copiar token inicial de API | Admin | Token gerado automaticamente, copiado uma única vez e configurado na MegaDesk. |
| Criar usuário do cliente | Admin | Usuário ativo, senha definida e permissões selecionadas. |
| Configurar variáveis na MegaDesk | Dev MegaDesk | `MEGAADMIN_API_BASE_URL`, `MEGAADMIN_CLIENT_ID` e `MEGAADMIN_API_TOKEN` presentes. |
| Testar health check | Dev MegaDesk | Retorno positivo com token e cliente válidos. |
| Testar login válido | QA/Dev | `200`, `success=true` e `allowed=true`. |
| Testar senha errada | QA/Dev | `401`, sem sessão criada. |
| Testar cliente não liberado | QA/Dev | `403`, sem sessão criada. |
| Testar usuário inativo | QA/Dev | `403`, sem sessão criada. |
| Testar cliente inexistente | QA/Dev | `404`, sem sessão criada. |

## 8. Regra final de negócio

A MegaDesk não deve liberar login apenas porque o usuário existe localmente. A liberação precisa passar pelo MegaAdmin. Na prática, a MegaDesk deve tratar a resposta do MegaAdmin como a chave da sessão: se `allowed=true`, a sessão pode ser criada; se `allowed=false` ou se o HTTP não for `200`, o login deve ser bloqueado.
