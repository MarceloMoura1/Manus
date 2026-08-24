# ERP — Vendas

Esta fatia implementa pedidos de venda tenant-aware com os estados `draft`, `confirmed`, `fulfilled` e `cancelled`. O pedido usa o cliente central de `megadesk_crm_clients`, guarda apenas o identificador público e um snapshot do nome, e guarda snapshots de nome, SKU, quantidade e preço dos produtos.

Totais são calculados exclusivamente no backend, em centavos inteiros, com quantidade de três casas e arredondamento half-up. Admin e manager podem escrever; agent e viewer têm apenas leitura e não recebem ações de escrita no DOM. O tenant sempre vem da sessão.

Confirmar não reserva estoque. A ação **Concluir venda** trava pedido e saldos em ordem determinística, valida estoque de todos os itens e, em uma única transação, cria o fulfillment, movimentos imutáveis `sale_out`, vínculos de itens, atualiza saldos, pedido e histórico. Estoque insuficiente causa rollback integral e mantém o pedido confirmado.

A conclusão exige chave idempotente única por tenant. Replay devolve o resultado original sem nova baixa ou evento; reutilização semântica em outro pedido é recusada. Eventos `erp:sale.changed` e `erp:stock.changed` são mínimos e emitidos apenas depois do commit.

A migration canônica 0008 é aditiva e cria pedidos, itens, histórico, sequência anual independente e fulfillment. Não há exclusão física nem integração externa.

Ficam fora desta fatia: orçamento, reserva antecipada, entrega parcial, logística, frete, pagamentos, parcelamento, comissão, descontos globais, impostos, NF-e/NFS-e, Financeiro, Fiscal, devolução, troca e estorno. Tabela de preços e autorização específica de desconto são evoluções futuras.

Testes físicos MySQL permanecem condicionais e devem ser executados somente em ambiente descartável autorizado. A validação local cobre contratos, estados, arredondamento, papéis, estrutura transacional, navegação e UI controlada sem screenshots ou vídeos.
