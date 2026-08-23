# Auditoria da Fase 2 — ERP

## Escopo e base

- Branch de trabalho: `feat/phase-2-erp`.
- Base: `554460964b08c8e6f3c45551a77a7fe06d87f4af`.
- Arquitetura oficial vigente: isolamento lógico tenant-aware no banco `main`.
- O schema físico por tenant é somente referência futura e não está autorizado para esta fase.
- Nenhuma migration, seed, container ou banco foi executado durante esta auditoria.

## Resumo executivo

O repositório não possui domínio ERP persistente. A única implementação chamada ERP é
um dashboard visual em `client/src/pages/Home.tsx`, com métricas, pedidos, clientes e
atividades fictícias. Não existem tabelas, migrations canônicas, repositories, services,
routers tRPC ou testes funcionais de produtos, estoque, fornecedores, compras, vendas e
financeiro.

A implementação funcional exige tabelas novas no schema `main`, migration canônica
aditiva não aplicada, repositories tenant-aware, services transacionais, autorização no
backend e páginas conectadas ao tRPC.

Existe um bloqueio de segurança anterior ao ERP: a sessão MegaDesk mantida no frontend
não possui credencial assinada apresentada ao backend. O contexto tRPC obtém
`tenantId` e `userEmail` dos headers `x-tenant-id` e `x-user-email`. O middleware
`megadeskProcedure` revalida acesso operacional no banco, mas o tenant efetivo ainda é
escolhido pelo cliente. Isso não satisfaz a exigência da Fase 2 de derivar o tenant de uma
sessão autenticada e nunca confiar no `clientId` recebido do frontend.

## Inventário classificado

| Área | Implementação encontrada | Classificação | Decisão de reutilização |
|---|---|---|---|
| Entrada de navegação ERP | Item único `erp` na sidebar de `Home.tsx` | Parcialmente funcional | Reutilizar o shell; substituir por grupo hierárquico |
| Rota ERP | Estado interno `RouteId = "erp"`, sem URL estável `/erp/*` | Legado | Consolidar em rotas estáveis com compatibilidade explícita |
| Dashboard ERP | `ERPPage` com números, pedidos e atividades codificados | Somente visual e inseguro | Remover dados fictícios; não reutilizar métricas |
| Produtos | Referência de leitura em `gemini-client.ts` sobre registros operacionais JSON | Legado e inseguro para ERP | Não usar como persistência de produtos |
| Estoque | Campo JSON consultado pela integração Gemini | Somente visual/legado | Não reutilizar; saldo deve derivar de movimentos |
| Fornecedores | Nenhuma entidade ou fluxo | Ausente | Implementar no domínio ERP |
| Compras | Nenhuma entidade ou fluxo | Ausente | Implementar no domínio ERP |
| Vendas | Métricas genéricas e textos de IA, sem domínio transacional | Somente visual | Implementar no domínio ERP |
| Financeiro ERP | Aba placeholder em Clientes e textos promocionais | Somente visual | Não reutilizar como domínio financeiro |
| Integrações ERP | Configurações genéricas existentes para n8n e outros serviços | Parcialmente funcional | Exibir estado real somente por contrato seguro; marcar demais como planejadas |
| Persistência ERP | Nenhuma tabela em `drizzle/schema.ts` | Ausente | Criar schema `main` tenant-aware |
| Schema físico tenant | Sete tabelas de referência, nenhuma tabela ERP e nenhum repository runtime | Legado não operacional | Não alterar ou ativar nesta fase |
| Migrations ERP | Nenhuma migration canônica | Ausente | Gerar migration aditiva e não aplicar |
| Repositories ERP | Nenhum | Ausente | Criar repositories com `client_id` obrigatório em toda operação |
| Services ERP | Nenhum | Ausente | Criar services transacionais e idempotentes |
| Router tRPC ERP | Nenhum | Ausente | Criar router fino após resolver identidade autenticada |
| Permissões de módulo | Roles `admin`, `manager`, `agent`, `viewer` e permissões por módulo | Funcional e reutilizável | Aplicar política conservadora baseada em roles e documentar granularidade futura |
| Autorização operacional | `megadeskProcedure` revalida tenant/e-mail no banco | Parcialmente funcional e insuficiente para o requisito | Requer sessão MegaDesk assinada antes do ERP |
| Isolamento lógico existente | Tabelas operacionais do `main` usam `client_id` | Funcional e reutilizável | Adotar para todas as tabelas ERP |
| Clientes para vendas | `megadesk_crm_clients` tenant-aware | Parcialmente funcional para associação | Reutilizar somente por repository e validação de ownership |
| SQL raw | Presente em routers e integrações legadas | Legado | Não reproduzir no ERP; usar Drizzle/repositories |
| Componentes visuais | Button, Input, Dialog, Select, cards e padrões de estados existentes | Funcional e reutilizável | Reutilizar sem criar design system paralelo |
| Responsividade de Conversas | Painel único abaixo de 900 px com E2E | Funcional e protegida | Não alterar |

## Dados fictícios e botões sem contrato

`ERPPage` contém valores fixos como vendas, pedidos atrasados, chamados, entregas,
status de pedidos e atividades recentes. Os filtros apenas alteram estado visual e não
consultam backend. Os blocos de gráfico são placeholders. Todo esse conteúdo deve ser
removido quando o painel real for implementado.

## Contratos e duplicidades

- Não há duplicidade de tabelas ERP porque elas ainda não existem.
- `operational_records` não é adequado para substituir entidades ERP relacionais,
  histórico imutável de estoque ou lançamentos financeiros.
- A leitura de “produtos ERP” no Gemini a partir de JSON operacional é um contrato
  legado e não deve orientar o novo modelo.
- A aba financeira de Clientes não representa contas a pagar/receber e não deve ser
  tratada como implementação existente do Financeiro.

## Autenticação e isolamento: bloqueio arquitetural

### Estado atual

1. `loginByEmail` valida a senha e retorna dados de sessão ao frontend.
2. O frontend persiste esses dados em `localStorage`.
3. Requisições enviam `x-tenant-id` e `x-user-email`.
4. `createContext` copia esses headers para o contexto tRPC.
5. `megadeskProcedure` revalida se o usuário informado pertence ao tenant informado.

### Lacuna

O backend não recebe uma credencial MegaDesk assinada que vincule de maneira
criptográfica usuário e tenant. Um cliente pode escolher os dois headers. A revalidação
reduz o risco, mas não torna o tenant derivado de sessão autoritativa.

### Impacto no ERP

Produtos, estoque e financeiro exigem garantia mais forte porque uma identidade
forjada pode causar leitura cross-tenant, baixa de estoque ou lançamento financeiro no
tenant escolhido. Implementar routers ERP sobre o contrato atual violaria requisito
explícito da Fase 2.

## Decisão necessária antes da implementação

É necessário escolher e autorizar um contrato de sessão MegaDesk assinado. A opção
recomendada é cookie `HttpOnly`, `Secure` em produção e `SameSite=Lax`, emitido após
`loginByEmail`, contendo identificadores opacos de usuário e tenant, com expiração curta.
O backend deve validar o cookie, carregar o usuário e tenant atuais do banco, verificar
lifecycle e permissões, e então preencher `ctx.tenantId` e `ctx.operationalUserId`.
Headers de tenant podem continuar temporariamente apenas como dado de compatibilidade
que deve coincidir com a sessão, nunca como fonte de autoridade.

Essa mudança afeta login, logout, contexto tRPC, testes de sessão e todos os fluxos
operacionais. Por proteger componentes estabilizados da Fase 1, requer autorização
arquitetural explícita antes de prosseguir.
# Estado após autorização da camada de autenticação

A autenticação operacional segura foi autorizada como pré-requisito isolado. O ERP continua bloqueado nesta rodada: nenhuma entidade, rota, tela ou migration funcional de ERP deve ser implementada até a revisão e aprovação explícita desta camada de sessão.

## Atualização — primeira fatia vertical autorizada

A sessão segura foi validada e publicada; o bloqueio anterior foi removido exclusivamente para Resumo, Produtos e Estoque. O dashboard fictício de `Home.tsx` foi substituído na navegação por `ERPWorkspace`, alimentado pelo router autenticado `erp`. O shell, componentes UI e tRPC foram reutilizados; métricas, pedidos e atividades fixas não são mais renderizados.

Foram criados schema main aditivo, repository tenant-aware, service transacional, schemas Zod, erros de domínio e router fino. `operational_records` e a leitura JSON legada do Gemini não foram reutilizados. Não havia tabela, rota ou repository equivalente que justificasse compatibilidade ou migração de dados.

A política inicial usa roles existentes: `admin`/`manager` escrevem e `agent`/`viewer` consultam. Fornecedores, Compras, Vendas, Financeiro e Integrações permanecem desabilitados e identificados como planejados, sem páginas ou botões falsos.
