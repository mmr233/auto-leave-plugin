const cardCache = new Map()
const shareCache = new Map()
const CARD_CACHE_MS = 5 * 60 * 1000
const MAX_CARDS = 500

function senderKey(event) {
  const botId = String(event?.self_id || event?.bot?.uin || event?.bot?.self_id || '')
  const userId = String(event?.user_id || '')
  return /^\d+$/.test(botId) && /^\d+$/.test(userId) ? `${botId}:${userId}` : ''
}

function cardKey(event, groupId) {
  const botId = String(event?.self_id || event?.bot?.uin || event?.bot?.self_id || '')
  const userId = String(event?.user_id || '')
  const target = String(groupId || '')
  return /^\d+$/.test(botId) && /^\d+$/.test(userId) && /^\d+$/.test(target)
    ? `${botId}:${userId}:${target}`
    : ''
}

function parseCard(value) {
  try {
    if (typeof value === 'string' && value.length > 65536) return null
    const card = typeof value === 'string' ? JSON.parse(value) : value
    if (card?.bizsrc !== 'qun.invite') return null
    const url = new URL(card.meta?.news?.jumpUrl || card.meta?.news?.jump_url || '')
    if (url.protocol !== 'mqqapi:' || url.hostname !== 'group' || url.pathname !== '/invite_join') return null
    const groupId = url.searchParams.get('groupcode') || ''
    const groupName = (url.searchParams.get('groupname') || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120)
    const receiverId = url.searchParams.get('receiveruin') || ''
    const senderId = url.searchParams.get('senderuin') || ''
    return /^\d+$/.test(groupId)
      ? { groupId, groupName: groupName || '未知群名', receiverId, senderId: /^\d+$/.test(senderId) ? senderId : '' }
      : null
  } catch {
    return null
  }
}

export function extractInviteCard(event) {
  if ((event?.message_type && event.message_type !== 'private') || (!event?.message_type && event?.group_id)) return null
  const candidates = Array.isArray(event?.message)
    ? event.message.filter(item => item?.type === 'json').map(item => item.data?.data ?? item.data)
    : []
  if (typeof event?.msg === 'string' && event.msg.trim().startsWith('{')) candidates.push(event.msg)
  if (typeof event?.raw_message === 'string') {
    const raw = event.raw_message.match(/\[CQ:json,data=([^\]]*)\]/i)?.[1]
    if (raw) candidates.push(raw.replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&'))
  }
  const botId = String(event?.self_id || event?.bot?.uin || event?.bot?.self_id || '')
  for (const candidate of candidates) {
    const card = parseCard(candidate)
    if (card && cardKey(event, card.groupId) && (!card.receiverId || card.receiverId === botId)) return card
  }
  return null
}

export function rememberInviteCard(event) {
  if (event?.message_type && event.message_type !== 'private') return false
  if (!event?.message_type && event?.group_id) return false
  const sender = senderKey(event)
  const source = [event?.msg, event?.raw_message, ...(Array.isArray(event?.message)
    ? event.message.map(item => typeof item.data === 'string' ? item.data : JSON.stringify(item.data || item))
    : [])].filter(value => typeof value === 'string').join('\n').slice(0, 65536)
  const links = [...source.matchAll(/https:\/\/qm\.qq\.com\/q\/[a-z0-9_-]{3,128}/gi)]
    .map(match => match[0])
  if (sender && links.length) {
    const old = shareCache.get(sender)
    const previous = old && Date.now() - old.receivedAt <= CARD_CACHE_MS ? old.links : []
    shareCache.delete(sender)
    shareCache.set(sender, { links: [...new Set([...links, ...previous])].slice(0, 3), receivedAt: Date.now() })
    while (shareCache.size > MAX_CARDS) shareCache.delete(shareCache.keys().next().value)
  }
  const card = extractInviteCard(event)
  if (card) {
    const key = cardKey(event, card.groupId)
    const now = Date.now()
    for (const [cachedKey, cached] of cardCache) {
      if (now - cached.receivedAt > CARD_CACHE_MS) cardCache.delete(cachedKey)
    }
    cardCache.delete(key)
    cardCache.set(key, { groupName: card.groupName, receivedAt: now })
    while (cardCache.size > MAX_CARDS) cardCache.delete(cardCache.keys().next().value)
    return true
  }
  return !!(sender && links.length)
}

export function findInviteCard(event, groupId) {
  const key = cardKey(event, groupId)
  const card = cardCache.get(key)
  if (!card) return null
  if (Date.now() - card.receivedAt > CARD_CACHE_MS) {
    cardCache.delete(key)
    return null
  }
  return card
}

export function findInviteShareUrls(event) {
  const key = senderKey(event)
  const cached = shareCache.get(key)
  if (!cached) return []
  if (Date.now() - cached.receivedAt > CARD_CACHE_MS) {
    shareCache.delete(key)
    return []
  }
  return cached.links
}
