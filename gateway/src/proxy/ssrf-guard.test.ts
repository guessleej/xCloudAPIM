import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  isBlockedIPv4, isBlockedIPv6, checkUpstream, _resetCache,
} from './ssrf-guard.js'

// 對應 docs/security/07-security-testing.md §3（SSRF 防護）

describe('SSRF guard — IPv4 範圍判定', () => {
  it('一律封鎖 loopback / link-local(metadata) / 0.0.0.0 / broadcast', () => {
    for (const ip of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '255.255.255.255']) {
      assert.equal(isBlockedIPv4(ip, false), true, `${ip} 應被封鎖`)
    }
  })

  it('blockPrivate=true 時封鎖 RFC1918 / CGNAT', () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '100.64.0.1']) {
      assert.equal(isBlockedIPv4(ip, true), true, `${ip} 應被封鎖`)
    }
  })

  it('blockPrivate=false 時放行私有位址（docker 內網開發）', () => {
    assert.equal(isBlockedIPv4('172.28.0.82', false), false)
    assert.equal(isBlockedIPv4('10.0.0.5', false), false)
  })

  it('放行公開位址', () => {
    assert.equal(isBlockedIPv4('8.8.8.8', false), false)
    assert.equal(isBlockedIPv4('1.1.1.1', true), false)
  })

  it('格式錯誤一律封鎖（fail-closed）', () => {
    assert.equal(isBlockedIPv4('999.1.1.1', false), true)
    assert.equal(isBlockedIPv4('abc', false), true)
  })
})

describe('SSRF guard — IPv6 範圍判定', () => {
  it('封鎖 loopback / link-local / unspecified', () => {
    assert.equal(isBlockedIPv6('::1', false), true)
    assert.equal(isBlockedIPv6('fe80::1', false), true)
    assert.equal(isBlockedIPv6('::', false), true)
  })

  it('IPv4-mapped 沿用 IPv4 規則', () => {
    assert.equal(isBlockedIPv6('::ffff:169.254.169.254', false), true)
    assert.equal(isBlockedIPv6('::ffff:8.8.8.8', false), false)
  })

  it('blockPrivate=true 封鎖 ULA(fc/fd)', () => {
    assert.equal(isBlockedIPv6('fd00::1', true), true)
    assert.equal(isBlockedIPv6('fd00::1', false), false)
  })
})

describe('SSRF guard — checkUpstream（IP literal）', () => {
  beforeEach(() => _resetCache())

  it('拒絕非 http(s) scheme', async () => {
    const r = await checkUpstream('file:///etc/passwd')
    assert.equal(r.ok, false)
  })

  it('拒絕 metadata 位址 literal', async () => {
    const r = await checkUpstream('http://169.254.169.254/latest/meta-data/')
    assert.equal(r.ok, false)
  })

  it('拒絕 loopback literal', async () => {
    const r = await checkUpstream('http://127.0.0.1:8080/admin')
    assert.equal(r.ok, false)
  })

  it('拒絕無效 URL', async () => {
    const r = await checkUpstream('not-a-url')
    assert.equal(r.ok, false)
  })

  it('放行公開 IP literal', async () => {
    const r = await checkUpstream('https://8.8.8.8/')
    assert.equal(r.ok, true)
  })
})
