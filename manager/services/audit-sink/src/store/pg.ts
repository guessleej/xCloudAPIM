import pg from 'pg'
import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import { config } from '../config/index.js'

let pool: pg.Pool

export async function connectPg(log: Logger): Promise<void> {
  pool = new pg.Pool({
    host:     config.POSTGRES_HOST,
    port:     config.POSTGRES_PORT,
    user:     config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
    max:      4,
    // 自簽憑證 → 不驗證 CA（P2-A）
    ssl:      config.POSTGRES_SSL_MODE === 'disable' ? false : { rejectUnauthorized: false },
  })
  const c = await pool.connect()
  await c.query('SELECT 1')
  c.release()
  log.info('PostgreSQL connected (audit-sink)')
}

export async function closePg(): Promise<void> {
  await pool?.end()
}

// hash-chain 序列化用的 advisory lock key（避免並行插入造成鏈斷裂）
const LOCK_KEY = 918273

export interface AuditRecord {
  topic:     string
  eventType?: string
  actor?:    string
  sourceIp?: string
  payload:   unknown
}

// appendAudit 以交易 + advisory lock 計算 hash chain 並插入（append-only，UPDATE/DELETE 由 DB 觸發器封鎖）
export async function appendAudit(rec: AuditRecord): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY])
    const prev = await client.query<{ row_hash: string }>(
      'SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1',
    )
    const prevHash = prev.rows[0]?.row_hash ?? ''
    const payloadStr = JSON.stringify(rec.payload)
    const rowHash = createHash('sha256')
      .update(`${prevHash}|${rec.topic}|${payloadStr}`)
      .digest('hex')
    await client.query(
      `INSERT INTO audit_log (topic, event_type, actor, source_ip, payload, prev_hash, row_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [rec.topic, rec.eventType ?? null, rec.actor ?? null, rec.sourceIp ?? null, payloadStr, prevHash, rowHash],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
