# Fase 2 ERP — Produtos e Estoque

## Escopo

Esta primeira fatia implementa Resumo, Produtos e Estoque. Fornecedores, Compras, Vendas, Financeiro e integrações externas permanecem planejados e desabilitados. A arquitetura oficial continua sendo isolamento lógico no banco main; não há ativação de banco físico por tenant.

## Entidades e ownership

- `erp_products`: produto pertencente a um único `client_id`, identificado externamente por UUID `public_id`.
- `erp_stock_balances`: saldo materializado único por `client_id + product_id`.
- `erp_stock_movements`: ledger imutável, único por `client_id + public_id` e por `client_id + idempotency_key`.

Toda consulta combina o tenant da sessão segura com a identidade pública. IDs internos não fazem parte das APIs. SKU e código de barras são únicos apenas dentro do tenant; código vazio vira `NULL`.

## Representações

Dinheiro é persistido como `BIGINT` em centavos. A API aceita e retorna inteiros seguros, e o frontend apenas formata em BRL. Quantidades usam `DECIMAL(18,3)` e atravessam o contrato como strings canônicas; os cálculos de saldo usam milésimos inteiros (`bigint`) no backend, sem aritmética binária de ponto flutuante.

Unidades iniciais: unidade, quilograma, litro e metro. Estoque negativo é bloqueado.

## Permissões

As roles existentes são reutilizadas, sem sistema paralelo:

- `admin` e `manager`: leitura, cadastro/edição, ativação/inativação e movimentações;
- `agent` e `viewer`: somente leitura;
- a role efetiva e o tenant vêm da sessão `megadesk_session`; input e headers não concedem autoridade.

## Produto

O ciclo é criar, editar, inativar e reativar. Não há exclusão física. Saldo não é editável no formulário do produto. Nome, SKU, preços, estoque mínimo e unidade são validados em frontend e backend; o backend normaliza novamente.

## Ledger, transação e concorrência

Uma movimentação:

1. valida identidade, role, produto, estado, quantidade e motivo;
2. inicia transação;
3. resolve idempotência dentro da transação;
4. bloqueia produto e saldo com `FOR UPDATE`;
5. calcula saldo anterior/posterior no backend;
6. insere ledger e atualiza saldo na mesma transação;
7. confirma e somente então retorna o resultado.

A linha de saldo ausente é criada com `INSERT IGNORE` e depois bloqueada. Deadlock e lock timeout têm até três tentativas com backoff limitado. Erros permanentes não são repetidos.

## Idempotência e reversão

A chave é UUID opaco, única por tenant. Replay idêntico retorna o movimento original; mesma chave com payload diferente falha fechado. Reversão cria movimento novo, referencia o original e possui unique por `client_id + reversal_of`; não edita o histórico e não pode produzir saldo negativo.

## APIs e interface

Router tRPC `erp`:

- `summary`;
- `products.list/detail/create/update/setActive`;
- `stock.list/move/reverse`.

Rotas visuais: `/erp`, `/erp/produtos` e `/erp/estoque`. As telas possuem loading, erro/retry, vazio, ausência de resultados, read-only por permissão, conflito e estoque insuficiente. Tabelas largas possuem rolagem interna delimitada.

## Migration e validação futura

`0005_perpetual_ink.sql` é aditiva e não foi aplicada nesta implementação. Antes do checkpoint operacional, usar exclusivamente MySQL descartável permitido pelo gate:

1. criar banco vazio `megadesk_test_*`;
2. aplicar a cadeia main canônica;
3. executar `server/modules/erp/mysql.integration.test.ts` com `RUN_DATABASE_INTEGRATION=1`;
4. validar constraints, dois tenants, concorrência, rollback, idempotência, reversão e agregados;
5. destruir apenas o banco/container descartável autorizado, preservando ambientes locais reais.

Rollback de implantação antes de uso consiste em não aplicar/publicar a migration. Depois de dados reais, não há rollback destrutivo autorizado: deve-se desativar a funcionalidade e produzir migration corretiva aditiva.

## Próximos módulos

Fornecedores e Compras serão a próxima fatia. O recebimento de compra deverá chamar o mesmo service de estoque com origem `purchase`; Vendas usará `sale`. Nenhuma dessas operações foi implementada aqui.
