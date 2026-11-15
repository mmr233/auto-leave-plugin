import { Config } from '../components/config.js'

function id(value) {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text : ''
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => ({
    botId: id(item.botId),
    groupId: id(item.groupId),
    userId: id(item.userId),
    count: Math.max(0, Number(item.count) || 0),
    blocked: item.blocked === true
  })).filter(item => item.botId && item.groupId && item.userId)
}

function key(botId, groupId, userId) {
  return `${id(botId)}:${id(groupId)}:${id(userId)}`
}

function load() {
  return normalizeEntries(Config.loadList('verifyFailures.json'))
}

export function isVerificationBlocked(botId, groupId, userId) {
  const target = key(botId, groupId, userId)
  return load().some(item => key(item.botId, item.groupId, item.userId) === target && item.blocked)
}

export function recordFailedVerification(botId, groupId, userId, limit) {
  const target = key(botId, groupId, userId)
  const entries = load()
  const existing = entries.find(item => key(item.botId, item.groupId, item.userId) === target)
  const next = {
    botId: id(botId),
    groupId: id(groupId),
    userId: id(userId),
    count: (existing?.count || 0) + 1,
    blocked: (existing?.count || 0) + 1 >= Math.max(2, Number(limit) || 3)
  }
  if (!next.botId || !next.groupId || !next.userId) return null
  const updated = existing
    ? entries.map(item => item === existing ? next : item)
    : [...entries, next]
  return Config.saveList('verifyFailures.json', updated) ? next : null
}

export function clearVerificationFailures(botId, groupId, userId) {
  const target = key(botId, groupId, userId)
  const entries = load()
  const remaining = entries.filter(item => key(item.botId, item.groupId, item.userId) !== target)
  return remaining.length !== entries.length && Config.saveList('verifyFailures.json', remaining)
}
