# Relatórios Essenciais — encerramento funcional do ERP

O MegaDesk passa a classificar seu conjunto nativo como **ERP Essencial**. A expansão funcional ERP está congelada: novos módulos nativos exigem demanda comercial comprovada. A prioridade de produto retorna a Conversas, Atendimento Ativo, Chamados, WhatsApp, IA, automações e integrações.

## Escopo e definições

Todos os períodos são inclusivos, normalizados em UTC e limitados a 366 dias. Dinheiro permanece em centavos inteiros e quantidades em milésimos. Paginação ocorre no banco, com até 100 linhas por página e 1.000 linhas por exportação.

- Vendas concluídas: pedidos `fulfilled`, somados por `total_cents` e `fulfilled_at`; draft e canceladas não entram.
- Compras recebidas: pedidos `received`, somados por `total_cents` e `received_at`; draft e canceladas não entram.
- Financeiro aberto: títulos `open`, separados entre `receivable` e `payable`. Pagos/recebidos usam títulos `settled` e `settled_at`. Cancelados não entram.
- Saldo consolidado: soma de `current_balance_cents` das contas financeiras ativas.
- Estoque baixo: produto ativo cujo saldo atual é menor que `minimum_stock`; sem saldo é saldo igual a zero.
- Clientes ativos: CRM com status `ativo`. Rankings usam somente Vendas concluídas do período.
- Fornecedores ativos: fornecedores com `active=1`. Rankings usam somente Compras recebidas do período.
- Fiscal interno: contagens de `draft`, `ready_for_integration`, `cancelled`, perfil de produto incompleto e configuração incompleta. Não representa faturamento ou conformidade fiscal.

Margem, lucro, rentabilidade, valorização contábil, DRE, impostos e previsões foram omitidos porque não existe custo histórico apropriado que sustente essas afirmações.

## Segurança e exportação

O tenant vem exclusivamente de `ctx.tenantId`. Admin e manager leem e exportam; viewer apenas lê; agent é bloqueado antes de qualquer consulta. Filtros usam publicIds. CSV é produzido em memória, sob demanda, sem IDs internos, tenant, CPF/CNPJ, telefone, e-mail, endereço, notas ou segredos. Células iniciadas por `=`, `+`, `-`, `@`, tab ou carriage return recebem prefixo seguro contra formula injection.

## Decisões arquiteturais

Nenhuma migration foi necessária: os índices tenant/status/data existentes sustentam as consultas operacionais. Não há tabela de relatório, materialized view, Redis, data warehouse, BI, construtor de dashboards ou evento `erp:report.changed`. O frontend invalida consultas com debounce a partir dos eventos ERP existentes.

Emissão fiscal real continuará sendo responsabilidade de integração especializada externa. Empresas que já possuem ERP podem mantê-lo; o MegaDesk poderá consumir e resumir seus dados por futuras Integrações, que continuam desabilitadas nesta entrega.
# Contratos das mÃ©tricas

Os intervalos usam dias civis UTC inclusivos (`00:00:00.000Z` atÃ© o fim do dia). O perÃ­odo anterior termina no dia imediatamente anterior e possui exatamente a mesma quantidade de dias, sem sobreposiÃ§Ã£o.

No Resumo Executivo, vendas concluÃ­das (`fulfilled`), compras recebidas (`received`) e liquidaÃ§Ãµes financeiras no intervalo possuem `current`, `previous`, `absoluteChange` e `percentageChange`. Quando o valor anterior Ã© zero, `percentageChange` Ã© `null`. Valores monetÃ¡rios permanecem em centavos e contagens permanecem inteiras. Saldo atual de contas, total de cadastros ativos, estoque atual e pendÃªncias fiscais sÃ£o fotografias instantÃ¢neas e, portanto, nÃ£o recebem comparaÃ§Ã£o temporal.

Listagens retornam `items`, `page`, `pageSize`, `total` e `totalPages`. A ordenaÃ§Ã£o padrÃ£o Ã© data decrescente para Vendas, Compras e Fiscal; movimento decrescente para Estoque; vencimento decrescente para Financeiro; valor concluÃ­do decrescente para Clientes e Fornecedores. O banco aplica o identificador interno somente como desempate estÃ¡vel; ele nunca integra o DTO.
