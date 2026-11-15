import { Config } from '../components/config.js'
import { executeLeaveGroup } from './groupCheck.js'
import { InviteManagementService, REVIEW_MODE } from './inviteManagement.js'
import { getGroup } from '../utils/groupAdmin.js'

const timers = new Map()
const leaving = new Set()

function reviewKey(review) {
  return `${review.botId}:${review.groupId}`
}

function cancelTimer(review) {
  const key = reviewKey(review)
  clearTimeout(timers.get(key))
  timers.delete(key)
}

function resolveBot(botId) {
  const root = globalThis.Bot
  const bot = root?.[botId] || root
  return String(bot?.uin || bot?.self_id || '') === String(botId) ? bot : null
}

function membership(bot, groupId) {
  if (bot?.gl instanceof Map) {
    if (bot.gl.size === 0) return null
    return bot.gl.has(groupId) || bot.gl.has(Number(groupId))
  }
  return !!getGroup(bot, groupId)
}

function scheduleReview(review, bot) {
  const key = reviewKey(review)
  if (timers.has(key) || leaving.has(key)) return
  const timer = setTimeout(() => {
    timers.delete(key)
    expireStayReview(review, bot).catch(err => logger.error(`[自动退群] 留群审核到期处理失败: ${err.message}`))
  }, Math.max(0, review.expiresAt - Date.now()))
  timer.unref?.()
  timers.set(key, timer)
}

async function leaveAfterReview(review, bot, reason) {
  const key = reviewKey(review)
  if (leaving.has(key)) return false
  const service = new InviteManagementService({ bot })
  const current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || current.status !== 'pending') return false

  leaving.add(key)
  cancelTimer(current)
  if (!service.saveStayReview({ ...current, status: 'leaving' })) {
    leaving.delete(key)
    return false
  }
  try {
    const config = Config.loadConfig()
    const message = reason === '群成员数量不足'
      ? config.leaveMessage.replace('{memberCount}', String(current.memberCount ?? '未知'))
        .replace('{minMemberCount}', String(config.minMemberCount))
      : service.formatInviteMessage('stayRejected', current)
    const success = await executeLeaveGroup({
      groupId: current.groupId,
      memberCount: current.memberCount,
      bot,
      message,
      groupName: current.groupName,
      reason
    })
    if (success) {
      service.removeStayReview(current)
    } else if (service.getStayReviews().some(item => item.requestId === current.requestId)) {
      service.saveStayReview({ ...current, status: 'pending' })
    }
    return success
  } finally {
    leaving.delete(key)
  }
}

export async function expireStayReview(review, bot) {
  const service = new InviteManagementService({ bot })
  let current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || Date.now() < current.expiresAt) return false
  if (current.status === 'leaving') {
    if (leaving.has(reviewKey(current))) return false
    if (!service.saveStayReview({ ...current, status: 'pending' })) return false
    current = { ...current, status: 'pending' }
  }
  if (service.isWhiteGroup(current.groupId) || service.isApprovedGroup(current.groupId)) {
    cancelTimer(current)
    return service.removeStayReview(current)
  }
  const inGroup = membership(bot, current.groupId)
  if (inGroup === null) return false
  if (!inGroup) {
    cancelTimer(current)
    return service.removeStayReview(current)
  }
  return leaveAfterReview(current, bot, '群成员数量不足')
}

export async function beginStayReview(groupId, memberCount, bot) {
  const service = new InviteManagementService({ bot })
  if (!service.botId || !service.config.enabled || service.config.reviewMode !== REVIEW_MODE.MANUAL) {
    return false
  }
  const existing = service.getStayReviews().find(item => item.groupId === String(groupId))
  if (existing) {
    scheduleReview(existing, bot)
    return true
  }

  const groupInfo = await service.getGroupInfo(groupId)
  const now = Date.now()
  const review = {
    kind: 'stay',
    requestId: `${service.botId}-stay-${now.toString(36)}-${groupId}`,
    botId: service.botId,
    groupId: String(groupId),
    groupName: groupInfo.groupName,
    memberCount,
    requestTime: now,
    expiresAt: now + service.config.stayReviewMinutes * 60 * 1000,
    status: 'pending',
    msgIds: [],
    manageGroupIds: []
  }
  if (!service.saveStayReview(review)) return false
  const notified = await service.sendReviewNotifications(review)
  if (!notified.manageGroupIds.length && !notified.notifiedUserIds.length && !notified.masterNotified) {
    service.removeStayReview(review)
    logger.warn(`[自动退群] 群 ${groupId} 人数不足且无可用的留群审核通知目标`)
    return false
  }
  const current = new InviteManagementService({ bot }).getStayReviews()
    .find(item => item.requestId === review.requestId && item.status === 'pending')
  if (!current) return true
  service.saveStayReview({ ...current, msgIds: notified.msgIds, manageGroupIds: notified.manageGroupIds })
  scheduleReview(review, bot)
  return true
}

export async function decideStayReview(review, approve, bot) {
  const service = new InviteManagementService({ bot })
  const current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || current.status !== 'pending' || Date.now() >= current.expiresAt) {
    if (current) await expireStayReview(current, bot)
    return { ok: false, message: '留群审核已过期或正在退群' }
  }
  if (approve) {
    if (!service.removeStayReview(current)) return { ok: false, message: '保存留群审核结果失败' }
    cancelTimer(current)
    return { ok: true, message: service.formatInviteMessage('stayApproved', current) }
  }
  const success = await leaveAfterReview(current, bot, '留群审核被拒绝')
  return {
    ok: success,
    message: success
      ? service.formatInviteMessage('stayRejected', current)
      : '退群失败，留群审核仍待处理'
  }
}

export function cancelStayReviewForGroup(e) {
  const botId = String(e.bot?.uin || e.bot?.self_id || e.self_id || '')
  if (String(e.user_id) !== botId) return false
  const service = new InviteManagementService(e)
  const review = service.getStayReviews().find(item => item.groupId === String(e.group_id))
  if (!review) return false
  cancelTimer(review)
  return service.removeStayReview(review)
}

export function reconcileStayReviews() {
  const reviews = Config.loadConfig().inviteManagement?.stayReviews || []
  for (const review of reviews) {
    const bot = resolveBot(review.botId)
    if (!bot) continue
    if (review.status === 'leaving' && timers.has(reviewKey(review))) {
      cancelTimer(review)
    }
    scheduleReview(review, bot)
  }
}
