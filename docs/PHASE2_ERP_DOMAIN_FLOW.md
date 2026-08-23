# Fluxo de domínio do ERP

## Fluxo atual implementado

```text
Produto → Saldo materializado → Movimentação imutável → Resumo agregado
```

Produto define identidade, preços e mínimo. O saldo é uma projeção eficiente do ledger. Toda mudança nasce de uma movimentação transacional e o Resumo agrega apenas dados tenant-aware persistidos.

## Fluxos futuros — contratos, não implementação

```text
Fornecedor → Compra → Recebimento → Entrada de estoque → Conta a pagar
Cliente → Venda → Confirmação/conclusão → Saída de estoque → Conta a receber
```

As origens futuras reservadas são `purchase`, `sale`, `purchase_reversal` e `sale_reversal`. Elas deverão fornecer referência opaca e idempotência, mas não existem routers, telas ou regras comerciais desses módulos nesta fatia.
