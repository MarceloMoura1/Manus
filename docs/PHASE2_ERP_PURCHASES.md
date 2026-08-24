# ERP — Compras

Compras implementa pedidos tenant-aware, itens com snapshots, histórico, recebimento integral e ledger. Dinheiro usa centavos inteiros; quantidade usa `DECIMAL(18,3)` e `bigint`. O total usa arredondamento half-up, calculado somente no servidor. `PO-AAAA-NNNNNN` vem de sequência anual independente e transacional por tenant.

A máquina permite `draft → approved|cancelled` e `approved → received|cancelled`; estados finais são imutáveis. Fornecedor/produtos devem estar ativos e no tenant ao criar/aprovar. Admin/manager escrevem; agent/viewer leem e não recebem ações no DOM. IDs internos nunca integram DTOs.

O recebimento trava pedido, itens e saldos, cria receipt, `purchase_in` e atualiza tudo na mesma transação. Falha reverte tudo. A chave idempotente é única por tenant e replay não duplica dados nem eventos. A reversão genérica de `purchase_in` é recusada.

Eventos `erp:purchase.changed` e `erp:stock.changed` são tenant-scoped, mínimos e posteriores ao commit. `/erp/compras` oferece filtros, paginação, detalhes, itens dinâmicos, aprovação, cancelamento e recebimento.

Ficam futuros: recebimento parcial/múltiplo, devolução, contas a pagar, fiscal, nota/impostos, frete/desconto, anexos, aprovação multinível, cotação e integrações. Vendas, Financeiro e Fiscal continuam em preparação.
