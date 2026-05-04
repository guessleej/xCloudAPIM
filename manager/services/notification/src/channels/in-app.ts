/**
 * In-App 通知 — 直接寫入 MongoDB，UI 輪詢或 SSE 讀取
 */
import { getNotificationLogsCol } from '../store/mongodb.js'

export async function saveInApp(
  orgId:     string,
  eventType: string,
  data:      Record<string, unknown>,
): Promise<void> {
  await getNotificationLogsCol().insertOne({
    channel:   'in_app',
    eventType,
    recipient: orgId,
    orgId,
    apiId:     data['apiId'] as string | undefined,
    subject:   data['subject'] as string | undefined,
    status:    'sent',
    attempts:  1,
    payload:   data,
    ts:        new Date(),
  })
}
