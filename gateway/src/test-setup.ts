// 測試預載：在載入任何讀取 config 的模組之前注入必要環境變數。
// 以 `tsx --import ./src/test-setup.ts --test ...` 方式於測試啟動最先執行。
// 不影響生產：生產的 INTERNAL_SERVICE_SECRET 由 docker-compose 注入（fail-closed）。
process.env['NODE_ENV'] ??= 'test'
process.env['INTERNAL_SERVICE_SECRET'] ??= 'test-internal-secret'
