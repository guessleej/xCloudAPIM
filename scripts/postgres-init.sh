#!/bin/bash
# PostgreSQL 容器初始化腳本（docker-entrypoint-initdb.d）
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- 建立唯讀角色（供報表查詢使用）
    DO \$\$ BEGIN
        CREATE ROLE apim_readonly;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;

    GRANT CONNECT ON DATABASE $POSTGRES_DB TO apim_readonly;
    GRANT USAGE ON SCHEMA public TO apim_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT ON TABLES TO apim_readonly;

    -- 建立 analytics 專用資料庫（若未存在）
    SELECT 'CREATE DATABASE apim_test'
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = 'apim_test'
    )\gexec
EOSQL

echo "✅ PostgreSQL 初始化完成"
