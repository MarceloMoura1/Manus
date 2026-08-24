# Restauração segura de Clientes

## Histórico e causa

A página central Clientes foi introduzida no commit
`743a3fd8377ca8028e97a7e6b5b011a8b24afffe` e evoluiu até o checkpoint
funcional `86f32b5bea598fedfcb06dd4d905c3606f35746a`. Ela não foi removida pelo
ERP: o componente, o item da sidebar e as integrações permaneceram no código.

A inacessibilidade era causada pela ausência de `clients` na lista backend de
módulos configuráveis. Além disso, o router histórico recebia `clientId` do
navegador, o que era incompatível com as sessões operacionais atuais.

## Identidades e isolamento

- `client_id` identifica internamente o tenant/empresa usuária do MegaDesk.
- `crm_client_id` identifica publicamente a pessoa ou empresa atendida pelo tenant.
- O navegador nunca envia nem recebe `client_id` nas operações de Clientes.
- O router deriva o tenant exclusivamente de `ctx.tenantId` e o repository inclui
  esse tenant em todas as consultas e escritas.
- Inexistente e cross-tenant produzem o mesmo `NOT_FOUND` público.

A tabela canônica `megadesk_crm_clients` e seu identificador UUID prefixado por
`crm-` foram preservados. Não foi criada tabela ou migration.

## Autorização

| Role | Página Clientes | Leitura | Escrita |
| --- | --- | --- | --- |
| admin | sim | sim | sim |
| manager | sim | sim | sim |
| agent | não | não | não |
| viewer | não | não | não |

Permissões persistidas são limitadas pela matriz da role e não podem ampliá-la.
O backend aplica a mesma regra a listagem, detalhe, cadastro, edição, timeline,
CSV, Conversas e Chamados. Atendimento e Chamados podem continuar exibindo a
identidade operacional mínima sem abrir o router completo de Clientes.

## Navegação e integrações

Clientes aparece visualmente dentro do workspace ERP, entre Resumo e Produtos. O
domínio continua central e compartilhado por Atendimento, Conversas, Chamados e
futuros consumidores; não existe cadastro, tabela ou estado duplicado no ERP.
ERP permanece como o único item correspondente na sidebar principal.

A rota canônica é `/erp/clientes`. A rota legada `/clientes` redireciona no
cliente para a rota canônica, preservando query string e fragmento. Deep link,
refresh e navegação voltar/avançar usam uma única instância de `ClientesPage`.
O parâmetro público `crmClientId` pode selecionar o cadastro correto; `client_id`
do tenant nunca integra a URL ou os inputs CRM.

Atendimento ativo preserva a normalização de telefone, a busca tenant-aware e o
retorno de `crmClientId`. Ao iniciar conversa, esse identificador é armazenado em
`crm_client_id`. O link para a página completa aponta diretamente para
`/erp/clientes` e aparece somente para admin/manager;
agent continua vendo apenas o resumo operacional.

Chamados usa `customer_id = crm_client_id` como vínculo explícito quando ele
existe. A busca por nome, empresa ou telefone permanece somente como fallback para
registros históricos cujo `customer_id` esteja vazio. Um vínculo explícito nunca é
substituído pela heurística.

## CSV, timeline e lifecycle

Importação e exportação CSV exigem admin/manager. Inputs são estritos, possuem
limite de 500 linhas na importação e não aceitam tenant. A exportação omite IDs e
neutraliza células iniciadas por caracteres de fórmula. O autor da timeline vem da
sessão, não do navegador.

A exclusão física pública foi descontinuada. O cadastro histórico já possui
status, mas uma fatia futura deve definir formalmente lifecycle, retenção, LGPD e
eventual anonimização antes de ampliar operações de inativação/exclusão.

## Limitações e próximos passos

Não havia contrato realtime histórico seguro para Clientes; nenhum evento novo
foi criado e os eventos WhatsApp/ERP não foram alterados. A mudança de navegação
não altera schema, migration ou persistência. Vendas, Financeiro e Fiscal devem
consumir futuramente este mesmo cadastro central. Compras e os demais módulos
posteriores permanecem em preparação.
