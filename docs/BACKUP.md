# MegaDesk — Estratégia de Backup

## Backup automático do banco (recomendado)

### Criar script de backup

```bash
sudo nano /opt/scripts/backup-megadesk.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/megadesk"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

# Backup do banco
mysqldump -u megadesk -pSUASENHA \
  --single-transaction \
  --routines \
  --triggers \
  megadesk_main > "$BACKUP_DIR/db_$DATE.sql"

# Comprimir
gzip "$BACKUP_DIR/db_$DATE.sql"

# Remover backups antigos
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete

echo "Backup criado: $BACKUP_DIR/db_$DATE.sql.gz"
```

```bash
chmod +x /opt/scripts/backup-megadesk.sh
```

### Agendar no cron (diário às 3h)

```bash
crontab -e
# Adicionar:
0 3 * * * /opt/scripts/backup-megadesk.sh >> /var/log/megadesk-backup.log 2>&1
```

## Restaurar backup

```bash
gunzip backup_20240101_030000.sql.gz
mysql -u megadesk -pSUASENHA megadesk_main < backup_20240101_030000.sql
```

## Backup antes de atualizações

Sempre faça backup antes de:
- `pnpm db:migrate:main` (com o gate explícito descrito em `docs/MIGRATIONS.md`)
- Atualizações de código
- Mudanças no schema

```bash
mysqldump -u megadesk -pSUASENHA megadesk_main > pre_update_$(date +%Y%m%d).sql
```

## O que fazer backup

| Item | Frequência |
|------|-----------|
| Banco MySQL | Diário |
| Arquivo `.env` | A cada mudança |
| Pasta `uploads/` (se houver) | Semanal |
| Configuração PM2 | A cada mudança |
| Config cloudflared | A cada mudança |
