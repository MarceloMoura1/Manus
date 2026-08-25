# ERP Fiscal — fundação e documentos internos

## Escopo e limite jurídico

Esta fatia organiza cadastros e documentos **internos**. Ela não emite, transmite ou autoriza NF-e, NFC-e, NFS-e, CT-e ou MDF-e; não gera XML fiscal, DANFE, chave de acesso ou protocolo; não usa certificado, provedor, SEFAZ ou prefeitura; e não calcula tributos. A interface informa: **“Emissão fiscal eletrônica ainda não configurada.”**

O Portal Nacional da NF-e distingue homologação e produção e esclarece que a validade jurídica depende de autorização de uso. A Receita Federal também trata NCM como classificação que exige aplicação das regras próprias, e CNAE como classificação oficial de atividade. Por isso, NCM, CNAE, CFOP e demais códigos são entrada configurada pelo usuário e snapshots internos; o MegaDesk não os infere nem declara correção tributária.

Fontes oficiais consultadas em 24/08/2026:

- Portal Nacional da NF-e — perguntas frequentes e ambientes: https://www.nfe.fazenda.gov.br/PORTal/perguntasFrequentes.aspx
- Receita Federal — NCM: https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/ncm
- Receita Federal — CNAE: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/cnpj/classificacao-nacional-de-atividades-economicas-2013-cnae/apresentacao
- CONFAZ — documentação EFD com referência a CFOP: https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/nota_tecnica_efd_icms_ipi_2023-001_v1-2.pdf

## Regra implementada, configuração e futuro

Implementado: isolamento tenant-aware, papéis, normalização sintática, configuração única com histórico, perfil fiscal 1:1 de produto, documentos internos, snapshots, sequência anual `FIS-AAAA-NNNNNN`, idempotência, histórico e realtime privado.

Configurado pelo usuário: regime declarado, indicador de contribuinte, inscrições, CNAE, município IBGE, ambiente, NCM, CEST, CFOP, origem, unidade, GTIN, código de serviço e natureza. `ready_for_integration` significa somente que o cadastro mínimo interno está preparado para uma integração futura; não significa pronto para emissão.

Futuro e fora desta fatia: regras oficiais por operação/UF/município, alíquotas e bases de ICMS, ICMS-ST, DIFAL, IPI, PIS, COFINS, ISS, retenções e benefícios; certificados; provedores; assinatura; XML; transmissão; autorização; cancelamento fiscal; obrigações acessórias e integração contábil.

## Arquitetura

- `contracts.ts`: schemas, normalização, papéis, completude, hash e payload realtime.
- `repository.ts`: SQL tenant-aware, locks e transações.
- `service.ts`: autorização independente do DOM e efeitos pós-commit.
- `router.ts`: tRPC derivando tenant exclusivamente de `ctx.tenantId`.
- `FiscalPage.tsx`: resumo, configuração, produtos incompletos, documentos, detalhe e histórico.

Admin e manager leem/escrevem; viewer lê; agent é bloqueado no backend e ocultado no workspace. Permissões persistidas arbitrárias não ampliam agent.

## Dados e transações

A migration `0010_huge_tombstone` adiciona configuração/histórico, perfil de produto, sequência, documentos, itens, histórico e operações idempotentes. Não duplica entidades existentes.

Criação por origem exige Venda `fulfilled` ou Compra `received`. Pedido, contraparte, itens e totais são lidos novamente sob lock e filtrados pelo tenant. Quantidades são snapshots em milésimos (`bigint`) e dinheiro em centavos (`bigint`). Uma unique física impede versão ativa duplicada por origem.

A sequência anual é bloqueada transacionalmente e nunca decrementada. Chaves idempotentes são únicas por tenant e acompanhadas de hash semântico. Replay equivalente retorna o documento; payload divergente retorna conflito. Documento preparado para integração fica imutável. Cancelamento apenas muda o documento interno e não toca pedido, estoque ou Financeiro.

## Realtime

Eventos: `erp:fiscal.settings.changed` e `erp:fiscal.document.changed`. O payload possui somente `publicId`, `operation` e `occurredAt`. Publicação ocorre após o retorno confirmado do repository. Rollback e replay não publicam. Admin, manager e viewer do tenant recebem; agent, sessão revogada, tenant pausado e outro tenant não recebem.

## Testes

Unitários e estruturais cobrem normalização, papéis, numeração, centavos/milésimos, payload, fronteira sem emissão, locks, origens autoritativas e navegação. O E2E controlado cobre configuração, produto, Compra/Venda, preparação, cancelamento, viewer, agent, retry, filtros e quatro viewports sem mídia. As matrizes MySQL, E2E MySQL e Socket.IO permanecem condicionais e preparadas para validação física posterior.
