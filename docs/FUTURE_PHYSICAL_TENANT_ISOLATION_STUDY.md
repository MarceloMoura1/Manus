# Estudo futuro — isolamento físico por tenant

Este estudo não faz parte da Fase 2 e não está autorizado para implementação.
O isolamento lógico tenant-aware no banco main permanece a arquitetura oficial
do MegaDesk. Qualquer adoção futura de isolamento físico exige decisão
arquitetural, ambiente de homologação, plano de migração e autorização
explícita antes do início dos trabalhos.

## Ponto de partida

A Fase 1 terminou com isolamento lógico tenant-aware no banco main. O schema
tenant e sua baseline são apenas contratos de referência: o runtime ainda não
possui repositories que consumam esses símbolos e a criação de banco físico
permanece deliberadamente bloqueada.

Uma eventual iniciativa futura de isolamento físico deve preservar as regras de
não executar DDL no startup, não usar a cadeia histórica de migrations e não
permitir exclusão física de tenants.

## Constatações de arquitetura

1. O schema tenant possui somente `conversations`, `tickets`, `bot_scripts`,
   `operational_records`, `users`, `integrations` e `audit_logs`. Antes de
   ativá-lo, é necessário decidir a propriedade de todas as entidades
   operacionais que hoje vivem no main.
2. Existem acessos diretos ao banco principal em repositories, routers e no
   webhook da Evolution. O roteamento não pode ser alterado parcialmente sem
   criar persistência híbrida e risco de divergência.
3. O provisionamento registra nomes com prefixo `tenant_`, enquanto o runner
   canônico aceita somente `mdsk_*`. A identidade física precisa ser estável,
   opaca e compatível com a validação canônica.
4. Cadastro no main, criação do database e migration tenant não formam uma
   transação atômica. O provisionamento físico deve ser uma saga idempotente,
   persistida e retomável.

## Sequência de implementação

### 1. Contrato de propriedade dos dados

Produzir uma matriz tabela por tabela que classifique cada entidade como:

- main: identidade, autenticação, plano, lifecycle, credenciais administrativas
  e catálogo do tenant;
- tenant: dados operacionais privados;
- Evolution: dados administrados exclusivamente pela Evolution;
- filas compartilhadas: decisão explícita e documentada entre main e tenant.

### 2. Infraestrutura de conexão

Implementar um `TenantDatabaseResolver` que:

- receba o tenant efetivo somente do contexto autenticado;
- consulte o nome físico no main;
- valide estritamente o padrão `mdsk_*`;
- mantenha pools limitados, observáveis e descartáveis;
- nunca aceite credenciais ou database informados pelo cliente;
- falhe fechado para tenant incompleto, não liberado ou em quarentena.

### 3. Schema tenant completo

Expandir `drizzle/tenant-schema.ts` conforme a matriz de propriedade e gerar
uma nova baseline canônica em `drizzle/tenant-migrations/`. A cadeia histórica
em `drizzle/` continua congelada e não operacional.

### 4. Primeira fatia vertical

Migrar primeiro customers, conversations, conversation messages, operações de
atendimento e o trecho correspondente do webhook Evolution. Essa fatia deve
exercitar tRPC, HTTP, webhook, realtime e persistência antes da expansão para
os demais módulos.

### 5. Provisionamento físico retomável

Implementar as etapas persistidas:

1. reservar o tenant no main;
2. criar o database físico;
3. aplicar a baseline tenant;
4. executar readiness;
5. marcar o tenant como `setup`;
6. liberar a operação somente por ação administrativa separada.

Uma repetição com a mesma chave idempotente deve retomar ou devolver a operação
existente, nunca criar outro banco.

### 6. Migração dos demais módulos

Migrar chamados, CRM e timeline, bot, configurações, IA, notificações e
registros operacionais por repositories. Cada fatia deve remover seus acessos
diretos ao main antes de ser considerada concluída.

### 7. Cutover

Para instalações sem dados implantados, preferir cutover por tenant novo e
evitar dual-write. Qualquer migração de tenant existente exige processo
operacional separado, autorização explícita, backup verificável e validação de
consistência.

## Critérios de aceite

- Nenhuma rota escolhe o tenant efetivo a partir de `input.clientId`.
- Um tenant não consulta nem altera outro, mesmo conhecendo identificadores
  válidos.
- Webhooks resolvem a instância no main e persistem no tenant correspondente.
- Uma falha intermediária de provisionamento pode ser retomada sem duplicação.
- Tenant incompleto, não liberado ou em quarentena falha fechado.
- Startup não cria DDL nem dados.
- Main e tenant possuem readiness independente.
- Testes de integração comprovam isolamento usando pelo menos dois bancos
  físicos.
- Migrations nunca são aplicadas automaticamente pelo runtime.
- Exclusão física permanece bloqueada.

## Primeiro entregável

O primeiro incremento de uma eventual iniciativa autorizada deve ser a matriz
de propriedade dos dados junto ao contrato do `TenantDatabaseResolver`. A
ativação de `createTenantDatabase` permanece bloqueada até existir decisão
arquitetural, ambiente de homologação, plano de migração, autorização explícita
e até esses contratos, seus testes e o readiness tenant estarem implementados.
