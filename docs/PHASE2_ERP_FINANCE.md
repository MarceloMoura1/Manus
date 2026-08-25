# Quinta fatia do ERP — Financeiro

## Escopo e modelo

A fatia implementa contas financeiras (`cash`/`bank`), categorias direcionais, contas a pagar e receber, liquidação integral, cancelamento, ledger imutável, saldos, resumo, filtros e paginação. Valores são inteiros em centavos; formatação existe somente no frontend. A migration canônica aditiva `0009_cool_proemial_gods.sql`, seu snapshot e journal foram gerados localmente e **não foram aplicados**.

Contas guardam saldo inicial e atual, política `allow_negative` e estado ativo. A criação registra `opening_balance` explicitamente no ledger, inclusive quando zero. O saldo atual só é modificado dentro da transação de liquidação. Contas e categorias são inativadas, nunca excluídas; dados históricos permanecem consultáveis.

Categorias aceitam `payable`, `receivable` ou `both`. Um título referencia uma categoria ativa e compatível. Títulos começam em `open`; somente `open → settled` e `open → cancelled` são permitidos. Valor, direção e origem não são editáveis; descrição, vencimento, categoria, conta prevista e observações podem mudar apenas enquanto aberto. Atraso é derivado de `status=open` e vencimento anterior ao dia atual.

## Origem controlada

Uma compra `received` pode gerar um `payable`; uma venda `fulfilled` pode gerar um `receivable`. A UI envia apenas pedido, vencimento, categoria, conta prevista e observações. O repository trava e consulta a origem pelo tenant, obtém total e parte autoritativos e não altera pedido ou estoque. A unique `(client_id, source_type, source_public_id)` limita cada origem a um título; replay retorna o registro existente sem novo evento.

Títulos manuais continuam disponíveis e podem ter fornecedor/cliente/parte opcional. Não há geração automática porque Compras e Vendas ainda não modelam condições completas de pagamento.

## Liquidação, ledger e idempotência

A liquidação trava título e conta com `FOR UPDATE`, exige título aberto, conta ativa e valor integral, calcula o sinal (`payable` reduz; `receivable` aumenta), aplica `allow_negative`, cria settlement e ledger, atualiza saldo e título e só então faz commit. Unique por tenant/título impede segunda liquidação; unique por tenant/chave garante idempotência e replay da resposta perdida. Falhas fazem rollback integral e não publicam evento.

Ledger não possui operação de update/delete no domínio. Cada linha registra saldo anterior e resultante. Cancelamento exige motivo, não movimenta saldo nem ledger e não pode ser revertido nesta fatia.

## Autorização, privacidade e realtime

`admin` e `manager` leem e escrevem; `viewer` é somente leitura; `agent` é recusado no backend e não vê Financeiro na navegação. Todas as consultas e joins relevantes incluem o tenant.

Eventos `erp:finance.entry.changed` e `erp:finance.account.changed` são publicados somente pós-commit com `{ publicId, operation, occurredAt }`. Não carregam valor, saldo, parte, descrição, vencimento, conta, observação, usuário ou tenant. Replay/rollback não publica evento adicional. O Financeiro não foi adicionado a DTOs de Atendimento, Conversas ou Chamados.

## Interface, testes e limitações

`/erp/financeiro` oferece resumo, saldos, contas, categorias, títulos manuais, geração por pedido, filtros, paginação, detalhe, ledger, liquidação e cancelamento. Cards são usados no mobile e tabela com overflow no desktop. Dialogs reutilizam o componente acessível existente; ações não aparecem para viewer e o módulo não aparece para agent. Testes locais cobrem contratos e estrutura; suites MySQL/E2E físicas são condicionais.

Ficam para evolução: pagamentos parciais, parcelas, juros, multa, desconto, renegociação, recorrência, conciliação, boleto, PIX, cartão, gateways, baixa automática, transferência, estorno, fluxo projetado avançado, centro de custo, contabilidade/DRE/competência, impostos, nota fiscal, integração bancária e exclusão física. Fiscal, Relatórios e Integrações permanecem em preparação.
