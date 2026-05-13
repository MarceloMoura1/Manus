# Contrato de integração MegaAdmin ↔ MegaDesk

Este documento descreve o contrato necessário para que **MegaAdmin seja a fonte de verdade** de clientes, usuários, permissões e liberação de acesso, enquanto a plataforma **MegaDesk** consome essa autoridade no momento do login. A regra operacional passa a ser simples: uma pessoa só entra na MegaDesk se o cliente existir no MegaAdmin, estiver ativo, estiver com acesso liberado e possuir um usuário ativo cadastrado no cliente correspondente.

## Fluxo operacional recomendado

| Etapa | Plataforma responsável | O que precisa acontecer | Resultado esperado |
|---|---|---|---|
| Cadastro do cliente | MegaAdmin | Criar o cliente, revisar plano, limite de usuários, módulos e marcar o cliente como `active` com `accessReleased=true`. | O tenant passa a ser reconhecido como habilitado. |
| Cadastro do usuário | MegaAdmin | Criar o usuário dentro do cliente, com e-mail único, senha, telefone, função e permissões. | O usuário passa a ser elegível para login na MegaDesk. |
| Token de integração | MegaAdmin | Gerar automaticamente o token inicial no cadastro do cliente e copiar esse segredo para a MegaDesk junto com o `clientId`. | A MegaDesk consegue consultar o MegaAdmin de forma segura sem etapa manual de criação inicial. |
| Tentativa de login | MegaDesk | Enviar `clientId`, e-mail e senha para o endpoint de validação do MegaAdmin com o token do cliente. | O MegaAdmin retorna `allowed=true`, tenant, usuário, permissões e token de sessão assinado. |
| Bloqueio administrativo | MegaAdmin | Pausar cliente, retirar liberação de acesso, inativar usuário ou revogar token. | Novos logins na MegaDesk são bloqueados imediatamente. |

## Endpoint obrigatório para login integrado

A MegaDesk deve chamar o endpoint abaixo sempre que um usuário tentar entrar na plataforma.

| Campo | Valor |
|---|---|
| Método | `POST` |
| URL em produção | `https://megadeskadm-kqwgiavj.manus.space/api/megadesk/integration/auth/validate` |
| URL em desenvolvimento | `https://3000-iedkuxhhabqgph4pw8h1q-7b2a691a.us2.manus.computer/api/megadesk/integration/auth/validate` |
| Header de autenticação | `Authorization: Bearer <TOKEN_DO_CLIENTE>` ou `x-megadesk-api-token: <TOKEN_DO_CLIENTE>` |
| Content-Type | `application/json` |

### Payload de requisição

```json
{
  "clientId": 77,
  "email": "usuario@cliente.com",
  "password": "senha-digitada-na-megadesk"
}
```

### Resposta de sucesso

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
    "modules": ["Atendimento Ativo", "Conversas", "Chamados", "Rastreamento", "ERP", "Configurações", "Configurar BOT", "Assistente IA"]
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

A MegaDesk deve usar os campos `client.tenantDatabaseName`, `user.role` e `user.permissions` para montar o contexto do usuário logado. O `sessionToken` pode ser armazenado pela MegaDesk como referência de sessão emitida pelo MegaAdmin, mas a MegaDesk também pode criar a própria sessão interna após receber `allowed=true`.

## Respostas de bloqueio

| HTTP | Quando acontece | Ação esperada na MegaDesk |
|---|---|---|
| `400` | `clientId`, `email` ou `password` ausente/inválido. | Mostrar erro de formulário e não tentar criar sessão. |
| `401` | Token ausente/inválido ou usuário/senha não cadastrado no MegaAdmin. | Mostrar mensagem genérica de credenciais inválidas. |
| `403` | Cliente pausado, acesso não liberado ou usuário inativo no MegaAdmin. | Informar que o acesso depende de liberação administrativa. |
| `404` | Cliente não existe no MegaAdmin. | Bloquear login e revisar cadastro do cliente no Admin. |
| `500` | Falha inesperada no MegaAdmin. | Exibir indisponibilidade temporária e registrar tentativa. |

## Variáveis necessárias na MegaDesk

| Variável | Obrigatória | Finalidade |
|---|---:|---|
| `MEGAADMIN_API_BASE_URL` | Sim | Base URL do MegaAdmin, por exemplo `https://megadeskadm-kqwgiavj.manus.space`. |
| `MEGAADMIN_CLIENT_ID` | Sim | ID do cliente cadastrado no MegaAdmin. |
| `MEGAADMIN_API_TOKEN` | Sim | Token inicial gerado automaticamente ao cadastrar o cliente no MegaAdmin; tokens posteriores podem ser rotacionados ou renovados no painel do cliente. |
| `MEGAADMIN_AUTH_VALIDATE_PATH` | Opcional | Caminho customizável; padrão `/api/megadesk/integration/auth/validate`. |

## Exemplo de chamada pela MegaDesk

```ts
async function validateLoginWithMegaAdmin(input: { email: string; password: string }) {
  const response = await fetch(`${process.env.MEGAADMIN_API_BASE_URL}/api/megadesk/integration/auth/validate`, {
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
  });

  const result = await response.json();
  if (!response.ok || !result.success || !result.allowed) {
    throw new Error(result.error || "Login não autorizado pelo MegaAdmin");
  }

  return result;
}
```

## Checklist para iniciar os testes

| Item | Quem executa | Status esperado |
|---|---|---|
| Criar cliente no MegaAdmin | Admin | Cliente aparece no painel com `status=active`. |
| Liberar acesso | Admin | Campo `accessReleased` ligado. |
| Criar primeiro usuário do cliente | Admin | Usuário ativo, e-mail correto, senha definida e permissões marcadas. |
| Copiar token inicial de API do cliente | Admin | Token gerado automaticamente no cadastro, copiado uma única vez e configurado na MegaDesk. |
| Configurar variáveis na MegaDesk | Dev MegaDesk | Base URL, client ID e token presentes no ambiente da MegaDesk. |
| Testar login válido | QA/Dev | Resposta `200` com `allowed=true`. |
| Testar usuário não cadastrado | QA/Dev | Resposta `401`, sem sessão. |
| Testar cliente sem liberação | QA/Dev | Resposta `403`, sem sessão. |
| Testar usuário inativo | QA/Dev | Resposta `403`, sem sessão. |

## Regra de arquitetura

A integração deve tratar o **MegaAdmin como autoridade administrativa** e a **MegaDesk como plataforma operacional**. Isso mantém as duas aplicações funcionando como uma engrenagem: o Admin controla quem existe, quem está liberado, quais módulos cada pessoa pode acessar e qual tenant deve ser usado; a MegaDesk executa o produto somente depois de receber essa autorização.
