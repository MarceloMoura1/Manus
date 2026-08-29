# Rollout canônico de atendimentos

`megadesk_domain_conversations` é o agregado canônico da experiência atual. As tabelas
`wa_conversations` e `wa_messages` permanecem isoladas, sem writes, triggers ou sincronização
novos; serão auditadas em fase futura antes de qualquer adaptação Meta.

`megadesk_domain_conversations_messages` é promovida como fonte normalizada futura. Durante
o rollout, o helper de persistência grava a linha normalizada e atualiza `messages_json` na
mesma transação. A leitura nova prefere linhas normalizadas; se não houver linhas, usa apenas
`messages_json`. Ela nunca concatena as duas fontes. O espelhamento existe exclusivamente para
rollback da aplicação antiga e deve ser retirado depois de auditoria, backup, backfill por
tenant e comparação física de contagens/IDs.

Para novas mensagens com mídia, o espelhamento legado é deliberadamente leve: preserva ID,
tipo, texto, timestamp, MIME type, filename e um marcador para a linha normalizada, mas não
repete `mediaData`, `base64` ou `dataUrl`. O payload completo permanece exclusivamente em
`media_reference`. Assim, rollback para código anterior continua exibindo texto e metadata,
mas não reproduz o binário de mídias recebidas depois da 0013. A compatibilidade é estrutural
e parcialmente funcional, não semanticamente completa para novas mídias.

Outbound grava e confirma uma tentativa `pending` antes de chamar o provider, reconciliando a
mesma linha para `sent` com o ID externo ou para `failed`. Se o provider confirmar e a
reconciliação falhar, a linha permanece `pending`. `client_attempt_id` é unique dentro do
tenant; retries de tentativas `pending` ou `failed` não reenviam automaticamente. A Evolution
não recebe uma chave idempotente do MegaDesk neste contrato, portanto a entrega externa é best
effort e uma nova confirmação humana deve usar uma nova tentativa.

A migration 0013 é somente aditiva. Campos de registros legados permanecem anuláveis. O
backfill posterior deve atribuir contatos e códigos públicos persistidos, em lotes auditáveis,
sem alterar datas, status, mensagens ou IDs existentes. Só depois disso uma migration separada
poderá endurecer constraints e iniciar a retirada de `messages_json`.

Inbound e criação outbound calculam a mesma identidade lógica
`SHA-256(tenant + NUL + provider + NUL + integration_id + NUL + contact_id)` e usam
`GET_LOCK("mdc:" + active_key)` antes de procurar/criar o atendimento. A unique
`uq_mdc_active_key` permanece como barreira final entre processos.

No conflito entre encerramento e novo inbound, a ordem dos locks do MySQL define o resultado:
se o encerramento confirmar primeiro, o inbound abre um novo ciclo; se o inbound confirmar
primeiro, o encerramento pode encerrar o ciclo que recebeu a mensagem. Em nenhum caso são
permitidos dois ciclos ativos para a mesma identidade.

Somente conflitos de `uq_mdc_public_code` consomem as cinco tentativas do gerador.
`uq_mdc_active_key` nunca é classificada como colisão de código público.
