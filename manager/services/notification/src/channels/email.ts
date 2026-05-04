import nodemailer, { type Transporter } from 'nodemailer'
import type { Logger } from 'pino'
import { config } from '../config/index.js'
import { renderEmail } from '../templates/index.js'

let transporter: Transporter

export function getMailTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   config.SMTP_HOST,
      port:   config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:   config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
    })
  }
  return transporter
}

export async function sendEmail(
  to:        string,
  eventType: string,
  data:      Record<string, unknown>,
  log:       Logger,
): Promise<{ ok: boolean; error?: string }> {
  const rendered = renderEmail(eventType, data)
  if (!rendered) {
    log.warn({ eventType }, 'no email template found')
    return { ok: false, error: `no template for ${eventType}` }
  }

  try {
    const info = await getMailTransporter().sendMail({
      from:    config.SMTP_FROM,
      to,
      subject: rendered.subject,
      html:    rendered.html,
      text:    rendered.text,
    })
    log.info({ to, eventType, messageId: info.messageId }, 'email sent')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    log.warn({ to, eventType, err }, 'email send failed')
    return { ok: false, error: msg }
  }
}
