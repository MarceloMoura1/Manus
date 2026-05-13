# API de Integração MegaDesk

Este documento define como a plataforma MegaDesk deve se integrar ao **MegaDesk Admin** sem misturar dados entre clientes. A integração usa autenticação por token de cliente e aplica escopo obrigatório por **clientId**, **tenantDatabaseName** e **telefone normalizado** do cliente final.

> Cada cliente cadastrado no Admin possui um namespace/base lógica própria. Todo dado operacional enviado pela plataforma MegaDesk precisa carregar o `clientId` da empresa e o `ownerPhone` do cliente final para que rastreio, ERP, conversas e chamados apareçam somente para o login/telefone correto.

## Regras de segurança e isolamento

A API foi desenhada para que a plataforma MegaDesk nunca consulte registros apenas por telefone global. O telefone sempre é combinado com o cliente autenticado por token, evitando que dois clientes diferentes com o mesmo número vejam informações um do outro.

| Camada | Campo obrigatório | Finalidade |
| --- | --- | --- |
| Autenticação | `Authorization: Bearer <token>` ou `x-megadesk-api-token` | Confirma que a chamada pertence ao cliente configurado no Admin. |
| Tenant | `clientId` | Identifica a empresa dona dos dados. |
| Base lógica | `tenantDatabaseName` | Namespace interno gerado pelo Admin para separar registros por cliente. |
| Cliente final | `ownerPhone` | Vincula rastreio, ERP, conversas e chamados ao telefone usado no login do cliente final. |
| Módulo | `recordType` | Define o tipo de registro: `tracking`, `erp`, `conversation` ou `ticket`. |

## Endpoints disponíveis

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/megadesk/integration/health?clientId=123` | Valida token e disponibilidade da integração do cliente. |
| `POST` | `/api/megadesk/integration/operational-data` | Envia dados operacionais da plataforma MegaDesk para o Admin. |
| `GET` | `/api/megadesk/integration/operational-data?clientId=123&ownerPhone=5511999999999` | Consulta dados operacionais isolados para o cliente final logado. |

## Envio de dados operacionais

A plataforma MegaDesk deve chamar este endpoint sempre que precisar sincronizar dados de rastreio, ERP, conversas ou chamados com a área administrativa.

```bash
curl -X POST "https://<dominio>/api/megadesk/integration/operational-data" \
  -H "Authorization: Bearer TOKEN_DO_CLIENTE" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": 123,
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

## Consulta pelo login do cliente final

Quando a outra plataforma de admin ou o portal do cliente final autenticar o usuário por telefone, ela deve consultar os registros usando o mesmo `ownerPhone`. Opcionalmente, pode enviar `ownerLogin` e `recordType` para restringir ainda mais o resultado.

```bash
curl "https://<dominio>/api/megadesk/integration/operational-data?clientId=123&ownerPhone=5511999999999&recordType=ticket" \
  -H "x-megadesk-api-token: TOKEN_DO_CLIENTE"
```

A resposta retorna apenas registros que combinam simultaneamente com o cliente autenticado, a base lógica do cliente e o telefone normalizado do login.

```json
{
  "success": true,
  "records": [
    {
      "id": 10,
      "clientId": 123,
      "recordType": "ticket",
      "ownerPhoneNormalized": "5511999999999",
      "title": "Chamado #2048",
      "status": "open"
    }
  ]
}
```

## Como a plataforma MegaDesk deve se integrar

A integração recomendada é simples: o Admin continua sendo o cadastro de clientes, gera automaticamente o token inicial de API no momento do cadastro e permanece como fonte de escopo multi-tenant. A plataforma MegaDesk envia eventos e dados operacionais para a API usando o token do cliente correspondente. No portal do cliente final, após o login por telefone, a plataforma consulta a API com o `ownerPhone` autenticado para exibir apenas os dados daquele cliente final.

| Fluxo | Responsável | Ação |
| --- | --- | --- |
| Cadastro da empresa | MegaDesk Admin | Cria o cliente, gera automaticamente o token inicial e cria namespace/base lógica. |
| Sincronização operacional | Plataforma MegaDesk | Envia rastreio, ERP, conversas e chamados com `clientId` e `ownerPhone`. |
| Login do cliente final | Plataforma/Portal do cliente | Autentica usuário e obtém telefone normalizado. |
| Exibição de dados | Plataforma/Portal do cliente | Consulta a API com `clientId`, token e `ownerPhone`. |
| Auditoria | MegaDesk Admin | Mantém dados separados por tenant e permite validar origem dos registros. |
