import { randomBytes } from 'node:crypto'

/** 產生唯一請求 ID，用於 Sorted Set member（防重複計數） */
export function randomReqId(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

/** 解析整數設定值，若無效則回傳 undefined */
export function parseIntCfg(val: string | undefined): number | undefined {
  if (!val) return undefined
  const n = parseInt(val, 10)
  return isFinite(n) && n > 0 ? n : undefined
}

/** 解析浮點設定值 */
export function parseFloatCfg(val: string | undefined, def: number): number {
  if (!val) return def
  const n = parseFloat(val)
  return isFinite(n) && n > 0 ? n : def
}
