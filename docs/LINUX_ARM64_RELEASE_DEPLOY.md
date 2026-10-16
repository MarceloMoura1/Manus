# Publicação Linux ARM64 com runtime verificado

Este documento define o procedimento **proposto** para promover um runtime Linux
ARM64 já produzido. Ele não é uma autorização para conexão SSH, migration,
alteração de serviço ou ativação de release.

O executor versionado é:

```bash
node scripts/operations/linux-arm64-release-deploy.mjs
```

Ele deve ser executado a partir de um checkout operacional aprovado por SHA
completo; não se copia o script para dentro do artefato candidato nem se confia
no `HEAD` de uma branch mutável.

## Limites de responsabilidade

O procedimento separa três propriedades:

1. **Integridade de bytes:** o executor exige nome, SHA-256 do TAR, SHA-256 do
   manifesto, commit e tree explícitos. Também faz parsing UTF-8 estrito, rejeita
   BOM, chaves duplicadas, campos desconhecidos, entradas inseguras, links que
   escapam do payload e conteúdo extra no TAR. GNU tar é obrigatório.
2. **Autenticidade da origem:** os hashes precisam vir de uma fonte aprovada e
   independente, como o artefato e a evidência de uma execução imutável do CI.
   Um hash informado pelo próprio host não é suficiente.
3. **Autorização operacional:** o executor não inicia serviço, não aplica
   migration, não acessa segredos e não controla systemd, PM2, Compose ou
   Cloudflared. A identidade do serviço e a autorização para a janela continuam
   sendo aprovadas pelo administrador.

## Layout proposto e gate de compatibilidade

O layout abaixo só pode ser criado ou usado depois de uma verificação remota
somente-leitura comprovar que ele não conflita com a instalação atual:

```text
/opt/megadesk/app/
  current -> releases/<sha>
  releases/<sha>/
  staging/<sha>-<uuid>/
  backups/backup-<utc>-<uuid>/
```

`current` deve ser um symlink relativo, diretamente abaixo da raiz gerenciada.
`releases`, `staging` e `backups` devem ser diretórios reais no mesmo filesystem.
O serviço ativo só pode ser reiniciado depois de o administrador comprovar que
ele resolve o runtime por `current`; o repositório não contém evidência de que
o processo do host Ubuntu usa systemd, PM2, Compose ou qualquer outro mecanismo.
Por isso, este tooling não tenta adivinhar nem executar um reload.

## Contrato da candidata atual

Os argumentos devem ser fornecidos por uma fonte de aprovação, nunca inferidos
de branch, nome aproximado ou `HEAD`:

```text
--expected-artifact-name megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz
--expected-tar-sha256 39e7db9495a9a642d3b76fd76992901385cbfd42b421b8e10b2e2dafcdddf51a
--expected-manifest-sha256 a8338d85254ba92da5f8f646e30f158f663ecd8113ef2f6356a9e01d9ae8dc8b
--expected-commit eb6d1b0221854f87f8878afe44323ab0c7815699
--expected-tree 6b31e4a3724cb699a7cad44a2ee05094d50608fc
```

O candidato é ancestral de `c8915ef6fe885dbff725bfae28d20cca2cf3f26f`; o
delta posterior é o pin do workflow ARM64. Isso não substitui a confirmação do
commit ativo no host durante a janela.

## Sequência futura, após gates operacionais aprovados

1. Validar a chave ED25519 do host por fingerprint recebida por canal
   administrativo independente. Usar `StrictHostKeyChecking=yes` e uma fonte
   local dedicada; não usar `ssh-keyscan` como prova.
2. Fazer inventário somente leitura: dono/permissões/filesystem do layout,
   runtime ativo, mecanismo de serviço, arquitetura `aarch64`, espaço, MySQL,
   migration journal, origem de configuração/estado e backup recuperável.
3. Copiar o TAR e o manifesto para uma área de entrada nova, exclusiva e com
   permissões do operador. A cópia não é confiável até o comando abaixo passar:

   ```bash
   pnpm release:linux-arm64-deploy verify \
     --tar <entrada-nova>/megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz \
     --manifest <entrada-nova>/megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.manifest.json \
     --expected-artifact-name megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz \
     --expected-tar-sha256 39e7db9495a9a642d3b76fd76992901385cbfd42b421b8e10b2e2dafcdddf51a \
     --expected-manifest-sha256 a8338d85254ba92da5f8f646e30f158f663ecd8113ef2f6356a9e01d9ae8dc8b \
     --expected-commit eb6d1b0221854f87f8878afe44323ab0c7815699 \
     --expected-tree 6b31e4a3724cb699a7cad44a2ee05094d50608fc
   ```

4. Criar e verificar o backup antes de qualquer staging. As raízes de
   configuração e estado são parâmetros explícitos fornecidos pelo administrador
   após o inventário; o comando falha se qualquer origem for link inseguro ou se
   o recibo não puder ser revalidado.

   ```bash
   pnpm release:linux-arm64-deploy backup \
     --managed-root /opt/megadesk/app \
     --active-link /opt/megadesk/app/current \
     --configuration-root <raiz-configuracao-aprovada> \
     --state-root <raiz-estado-aprovada>
   ```

   O recibo contém hashes da release anterior e dos snapshots de configuração e
   estado. Ele não imprime valores de configuração. Uma cópia no mesmo disco não
   prova recuperação diante de perda desse disco: a política de retenção e a
   segunda cópia independente continuam obrigatórias.

5. Extrair somente para `staging`, verificar integralmente o manifesto de novo,
   e então usar o comando `activate` com o caminho do recibo de backup. A troca
   do symlink `current` é atômica no mesmo filesystem. Não execute esse comando
   antes de registrar o mecanismo de restart e os health checks reais do host.

   ```bash
   pnpm release:linux-arm64-deploy stage \
     --managed-root /opt/megadesk/app \
     --tar <entrada-nova>/megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz \
     --manifest <entrada-nova>/megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.manifest.json \
     --expected-artifact-name megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz \
     --expected-tar-sha256 39e7db9495a9a642d3b76fd76992901385cbfd42b421b8e10b2e2dafcdddf51a \
     --expected-manifest-sha256 a8338d85254ba92da5f8f646e30f158f663ecd8113ef2f6356a9e01d9ae8dc8b \
     --expected-commit eb6d1b0221854f87f8878afe44323ab0c7815699 \
     --expected-tree 6b31e4a3724cb699a7cad44a2ee05094d50608fc

   pnpm release:linux-arm64-deploy activate \
     --managed-root /opt/megadesk/app \
     --active-link /opt/megadesk/app/current \
     --stage <stage-passado-pelo-comando-anterior> \
     --backup-receipt <recibo-backup-verificado> \
     --expected-artifact-name megadesk-runtime-eb6d1b0221854f87f8878afe44323ab0c7815699-linux-arm64.tar.gz \
     --expected-tar-sha256 39e7db9495a9a642d3b76fd76992901385cbfd42b421b8e10b2e2dafcdddf51a \
     --expected-manifest-sha256 a8338d85254ba92da5f8f646e30f158f663ecd8113ef2f6356a9e01d9ae8dc8b \
     --expected-commit eb6d1b0221854f87f8878afe44323ab0c7815699 \
     --expected-tree 6b31e4a3724cb699a7cad44a2ee05094d50608fc
   ```
6. Reiniciar exclusivamente o serviço de aplicação pelo mecanismo que o
   inventário remoto identificar, sem tocar em MySQL, Evolution, Cloudflared ou
   serviços de staging. Após o restart aprovado, o health local exige tanto o
   status quanto o SHA da candidata:

   ```bash
   pnpm release:linux-arm64-deploy health \
     --url http://127.0.0.1:<porta-aprovada>/healthz \
     --expected-commit eb6d1b0221854f87f8878afe44323ab0c7815699
   ```

   O comando aceita exclusivamente loopback e não substitui o readiness público,
   a inspeção sanitizada de logs ou o fluxo de PDF com sessão autorizada.
7. Se a release falhar, usar `rollback` com o mesmo recibo para restaurar apenas
   o ponteiro de código anterior e repetir os health checks:

   ```bash
   pnpm release:linux-arm64-deploy rollback \
     --managed-root /opt/megadesk/app \
     --active-link /opt/megadesk/app/current \
     --backup-receipt <recibo-backup-verificado>
   ```

   Isso não desfaz DDL.

## Migration 0040

`0040_whole_exiles.sql` altera o enum de `erp_sale_documents.document_type`
para incluir `quote_pdf`. A migration fica fora deste executor. Ela só pode ser
aplicada pela cadeia canônica aprovada depois de confirmar versão MySQL, journal,
backup recuperável e recuperação supervisionada. O rollback de código não é uma
promessa de rollback de banco após DDL parcial ou irreversível.

## Condições de interrupção

Interromper antes de qualquer mutação se ocorrer qualquer uma destas situações:

- fingerprint SSH, usuário, destino, arquitetura ou serviço não correspondem ao
  inventário aprovado;
- GNU tar não está disponível;
- hashes, schema, commit, tree, nome ou conteúdo do TAR divergem;
- `current` não é um symlink relativo para uma release preservada;
- backup/recibo não valida integralmente, há espaço insuficiente ou a origem de
  configuração/estado contém links inseguros;
- não há health check e mecanismo de reload específico e aprovado;
- migration pendente sem backup recuperável e política de recuperação aprovada.

## Limitações conhecidas

O tooling cobre integridade do bundle, staging, snapshots locais verificáveis e
troca/rollback do ponteiro de código. Ele não autentica o artefato por assinatura,
não descobre segredos, não prova a recuperabilidade de cópia externa, não elimina
TOCTOU de escritores não coordenados e não valida Linux ARM64 nativo fora do CI
que produziu a candidata. Esses gates permanecem operacionais.
