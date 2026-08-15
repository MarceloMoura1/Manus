# Cadeia histórica congelada — não executar

Os SQLs numerados diretamente em `drizzle/`, os snapshots em `drizzle/meta/`,
`drizzle/migrations/` e `drizzle/migrations-backup/` são preservados apenas para
auditoria. Nenhuma configuração ou comando operacional aponta para eles.

A cadeia não é reproduzível: o journal referencia `0001_sad_whiplash`,
`0002_chilly_lethal_legion` e `0007_certain_runaways`, que nunca existiram no
histórico alcançável, enquanto os SQLs presentes nesses índices têm outro
conteúdo. `0018_mushy_rogue` foi arquivada em `migrations-backup`. O primeiro
estado inconsistente apareceu no commit `01c445e`; `0007` foi registrado sem SQL
em `13230440`; a organização do legado ocorreu em `9a6dc629`.

Esta cadeia foi substituída pelas baselines canônicas em `main-migrations/` e
`tenant-migrations/`. Não há suporte a upgrade automático do legado. Instalações
limpas devem começar nas novas baselines.
