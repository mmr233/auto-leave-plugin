import { findInviteShareUrls } from './inviteCard.js'

const MAX_BYTES = 512 * 1024
const TIMEOUT_MS = 4000

function allowedUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    return (url.hostname === 'qm.qq.com' && /^\/q\/[a-z0-9_-]{3,128}\/?$/i.test(url.pathname)) ||
      (url.hostname === 'qun.qq.com' && url.pathname === '/universal-share/share')
  } catch {
    return false
  }
}

export function parseInviteSharePage(html, groupId) {
  try {
    const json = String(html).match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
    if (!json) return null
    const data = JSON.parse(json)
    if (!Array.isArray(data)) return null
    for (const item of data) {
      if (!item || Array.isArray(item) || typeof item !== 'object' || !Object.hasOwn(item, 'groupcode')) continue
      const id = data[item.groupcode]
      const count = data[item.memberCnt]
      const name = data[item.name]
      if (String(id) !== String(groupId)) continue
      return {
        groupId: String(id),
        groupName: typeof name === 'string' ? name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 120) : '',
        memberCount: Number.isSafeInteger(count) && count > 0 ? count : null
      }
    }
  } catch {}
  return null
}

async function readPage(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) return ''
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function getInviteShareInfo(event, groupId) {
  const links = findInviteShareUrls(event)
  if (!links.length || typeof globalThis.fetch !== 'function') return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  timer.unref?.()
  try {
    for (const link of links) {
      let url = link
      for (let redirects = 0; redirects <= 2 && allowedUrl(url); redirects++) {
        const response = await fetch(url, { redirect: 'manual', signal: controller.signal })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) break
          url = new URL(location, url).href
          continue
        }
        if (!response.ok) break
        const info = parseInviteSharePage(await readPage(response), groupId)
        if (info) return info
        break
      }
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 获取群分享页失败: ${err.name}`)
  } finally {
    clearTimeout(timer)
  }
  return null
}
