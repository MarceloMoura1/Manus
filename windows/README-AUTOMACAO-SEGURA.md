# Automacao local segura do MegaDesk

Esta automacao substitui, para o fluxo atual, os arquivos `.bat` legados. Ela nao
configura inicializacao automatica, nao instala servicos e nao controla Evolution,
n8n, MySQL fora do container existente ou qualquer volume Docker.

## Instalar atalhos

No Windows PowerShell 5.1, sem privilegios administrativos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Instalar-Atalhos-MegaDesk.ps1
```

Sao criados quatro atalhos na Area de Trabalho: `Iniciar MegaDesk`,
`Atualizar MegaDesk`, `Parar MegaDesk` e `Diagnosticar MegaDesk`.

`Diagnosticar MegaDesk` e a contingencia read-only quando Node ou MegaAdmin nao
respondem. Ele nao inicia ou encerra processos, nao altera Docker, Git ou banco e
nao chama Repair, Connect ou QR. O relatorio JSON nasce de uma allowlist, tem no
maximo 64 KiB e fica em `%LOCALAPPDATA%\MegaDesk\diagnostics`, herdando a ACL do
runtime existente. Somente estados, HTTP seguros, contagens por categoria e flags
booleanas sao gravados; mensagens, contatos, payloads e credenciais sao excluidos.

## Estado e logs

PIDs, identidade dos processos, backups de `dist` e logs operacionais sanitizados
ficam em `%LOCALAPPDATA%\MegaDesk`. O arquivo `.env.local` e seus valores nunca sao
copiados para esse diretorio nem enviados por argumentos de processo.

## Atualizacao com testes

O atalho de atualizacao nao executa a suite completa. Para habilita-la explicitamente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Atualizar-MegaDesk.ps1 -RunTests
```

O fluxo nunca executa migrations ou comandos Git mutantes. Mudancas pendentes em
schema, migrations ou metadados Drizzle bloqueiam a publicacao.

## Observacao sobre os scripts legados

`start-megadesk.bat`, `stop-megadesk.bat` e os instaladores de auto-start foram
preservados apenas por compatibilidade historica. Eles nao possuem os guardrails
desta automacao e nao devem ser usados para este fluxo.
