import { Config } from '../components/config.js'
import { executeLeaveGroup } from './groupCheck.js'
import { InviteManagementService, REVIEW_MODE } from './inviteManagement.js'
import { callBotApi } from '../utils/groupAdmin.js'
import { isApiSuccess, sendGroupMessage } from '../utils/groupInfo.js'

const timers = new Map()
const leaving = new Set()
const notifying = new Set()
const recoveringJoins = new Set()

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

async function membership(bot, groupId) {
  if (bot?.gl instanceof Map) {
    if (bot.gl.has(groupId) || bot.gl.has(Number(groupId))) return true
  }
  try {
    const response = await callBotApi(bot, 'get_group_list', { no_cache: true })
    const groups = response?.data ?? response?.response ?? response
    if (!isApiSuccess(response) || !Array.isArray(groups) || groups.length === 0) return null
    return groups.some(item => String(item?.group_id ?? item?.groupId) === String(groupId))
  } catch {
    return null
  }
}

function scheduleReview(review, bot) {
  const key = reviewKey(review)
  if (timers.has(key) || leaving.has(key)) return
  const timer = setTimeout(() => {
    timers.delete(key)
    expireStayReview(review, bot).catch(err => logger.error(`[自动退群] 留群审核到期处理失败: ${err.message}`))
  }, review.status === 'leaving' ? 0 : Math.max(0, review.expiresAt - Date.now()))
  timer.unref?.()
  timers.set(key, timer)
}

async function notifyReviewExpired(service, review) {
  const message = service.formatInviteMessage('stayExpiredNotification', review)
  for (const groupId of review.manageGroupIds || []) {
    try {
      if (!isApiSuccess(await sendGroupMessage(service.bot, Number(groupId) || groupId, message))) {
        logger.warn(`[自动退群] 群 ${groupId} 的留群审核结束通知未送达`)
      }
    } catch (err) {
      logger.warn(`[自动退群] 发送留群审核结束通知失败: ${err.message}`)
    }
  }
  await service.notifyUsers(message, [review.userId])
  if (service.config.notifyInviterOnExpiry && review.userId) await service.notifyInviter(review, message)
  if (!Config.loadConfig().notification?.enabled) await service.notifyMaster(message)
}

function saveReviewCooldown(service, review) {
  const minutes = review.cooldownMinutes ?? service.config.stayReviewCooldownMinutes
  return review.reviewType === 'cooldown' || minutes <= 0 || service.setStayCooldown(review.groupId, minutes)
}

async function leaveAfterReview(review, bot, reason) {
  const key = reviewKey(review)
  if (leaving.has(key)) return false
  const service = new InviteManagementService({ bot })
  const current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || current.status !== 'pending') return false

  leaving.add(key)
  cancelTimer(current)
  if (!service.saveStayReview({ ...current, status: 'leaving', leaveStartedAt: Date.now(), leaveReason: reason })) {
    leaving.delete(key)
    return false
  }
  try {
    const config = Config.loadConfig()
    const message = reason === '群成员数量不足'
      ? config.leaveMessage.replace('{memberCount}', String(current.memberCount ?? '未知'))
        .replace('{minMemberCount}', String(config.minMemberCount))
      : service.formatInviteMessage(reason === '留群审核被拒绝' ? 'stayRejected' : 'stayExpired', current)
    const success = await executeLeaveGroup({
      groupId: current.groupId,
      memberCount: current.memberCount,
      bot,
      message,
      groupName: current.groupName,
      reason,
      skipGroupMessage: current.reviewType === 'cooldown'
    })
    if (success) {
      if (!saveReviewCooldown(service, current)) {
        logger.error(`[自动退群] 群 ${current.groupId} 已退群，但冷却保存失败，将重试`)
        return true
      }
      if (!service.removeStayReview(current)) {
        logger.error(`[自动退群] 群 ${current.groupId} 已退群，但清理审核状态失败，将重试`)
        return true
      }
      if (reason !== '留群审核被拒绝' && current.reviewType !== 'cooldown') {
        await notifyReviewExpired(service, current)
      }
    } else {
      const latest = new InviteManagementService({ bot })
      const pending = latest.getStayReviews().find(item => item.requestId === current.requestId && item.status === 'leaving')
      if (pending) latest.saveStayReview({ ...pending, status: 'pending', expiresAt: Math.min(pending.expiresAt, Date.now()) })
    }
    return success
  } finally {
    leaving.delete(key)
  }
}

export async function expireStayReview(review, bot) {
  const service = new InviteManagementService({ bot })
  let current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || (current.status !== 'leaving' && Date.now() < current.expiresAt)) return false
  const wasLeaving = current.status === 'leaving'
  if (wasLeaving) {
    if (leaving.has(reviewKey(current))) return false
  }
  if (!service.isBlackGroup(current.groupId) && (service.isWhiteGroup(current.groupId) ||
    (current.reviewType !== 'cooldown' && service.isApprovedGroup(current.groupId)))) {
    cancelTimer(current)
    return service.removeStayReview(current)
  }
  // A direct join event can precede the adapter's group-list refresh.
  const recentlyJoined = current.reviewType === 'cooldown' && current.joinObservedAt > 0 &&
    Date.now() - current.joinObservedAt < 30000
  const inGroup = recentlyJoined || await membership(bot, current.groupId)
  if (inGroup === null) return false
  if (!inGroup) {
    cancelTimer(current)
    if (wasLeaving && !saveReviewCooldown(service, current)) {
      logger.error(`[自动退群] 群 ${current.groupId} 的冷却保存失败，将重试`)
      return false
    }
    const removed = service.removeStayReview(current)
    if (removed && wasLeaving && current.reviewType !== 'cooldown' && current.leaveReason !== '留群审核被拒绝') {
      await notifyReviewExpired(service, current)
    }
    return removed
  }
  if (wasLeaving) {
    if (!service.saveStayReview({ ...current, status: 'pending' })) return false
    current = { ...current, status: 'pending' }
  }
  const reason = current.reviewType === 'cooldown'
    ? '留群审核退群冷却中'
    : current.reviewType === 'post_join' ? '留群审核超时' : '群成员数量不足'
  return leaveAfterReview(current, bot, current.leaveReason || reason)
}

async function notifyStayReview(review, bot) {
  const key = reviewKey(review)
  if (notifying.has(key)) return null
  notifying.add(key)
  try {
    let service = new InviteManagementService({ bot })
    const [groupInfo, userInfo] = await Promise.all([
      service.getGroupInfo(review.groupId),
      review.userId ? service.getUserInfo(review.userId) : { nickname: '未知用户' }
    ])
    service = new InviteManagementService({ bot })
    const current = service.getStayReviews().find(item => item.requestId === review.requestId && item.status === 'pending')
    if (!current || Date.now() >= current.expiresAt) return null
    const count = current.memberCount ?? groupInfo.memberCount
    const excludeBot = service.config.excludeBotFromPrecheck
    const updated = {
      ...current,
      groupName: groupInfo.groupName || current.groupName,
      nickname: userInfo.nickname || current.nickname,
      memberCount: count,
      checkedMemberCount: count == null ? null : Math.max(0, count - (excludeBot ? 1 : 0)),
      countBasis: excludeBot ? '不含本机器人' : '含本机器人'
    }
    if (!service.saveStayReview(updated)) return null
    const notified = await service.sendReviewNotifications({ ...updated, kind: 'stay' })
    service = new InviteManagementService({ bot })
    const latest = service.getStayReviews().find(item => item.requestId === review.requestId && item.status === 'pending')
    if (!latest) return notified
    const delivered = notified.manageGroupIds.length > 0 || notified.notifiedUserIds.length > 0 || notified.masterNotified
    service.saveStayReview({ ...latest, msgIds: notified.msgIds, manageGroupIds: notified.manageGroupIds, noticeSent: delivered })
    return notified
  } finally {
    notifying.delete(key)
  }
}

export async function beginStayReview(groupId, memberCount, bot, options = {}) {
  const service = new InviteManagementService({ bot })
  const reviewType = options.reviewType || 'low_members'
  if (!service.botId || (reviewType === 'low_members' &&
    (!service.config.enabled || service.config.reviewMode !== REVIEW_MODE.MANUAL))) {
    return false
  }
  const existing = service.getStayReviews().find(item => item.groupId === String(groupId))
  if (existing) {
    scheduleReview(existing, bot)
    if (existing.reviewType !== 'cooldown' && !existing.noticeSent) await notifyStayReview(existing, bot)
    return true
  }

  const now = Date.now()
  const review = {
    kind: 'stay',
    requestId: `${service.botId}-stay-${now.toString(36)}-${groupId}`,
    botId: service.botId,
    groupId: String(groupId),
    groupName: '未知群名',
    userId: String(options.userId || ''),
    nickname: '未知用户',
    memberCount,
    reviewType,
    cooldownMinutes: reviewType === 'cooldown' ? 0 : service.config.stayReviewCooldownMinutes,
    joinObservedAt: now,
    requestTime: now,
    expiresAt: reviewType === 'cooldown' ? now : now + service.config.stayReviewMinutes * 60 * 1000,
    status: 'pending',
    msgIds: [],
    manageGroupIds: []
  }
  if (!service.saveStayReview(review)) return false
  scheduleReview(review, bot)
  if (reviewType === 'cooldown') return true
  const notified = await notifyStayReview(review, bot)
  if (reviewType === 'low_members' && notified && !notified.manageGroupIds.length && !notified.notifiedUserIds.length && !notified.masterNotified) {
    const latest = new InviteManagementService({ bot }).getStayReviews().find(item => item.requestId === review.requestId)
    if (latest) service.removeStayReview(latest)
    cancelTimer(review)
    logger.warn(`[自动退群] 群 ${groupId} 人数不足且无可用的留群审核通知目标`)
    return false
  }
  if (reviewType === 'post_join' && notified && !notified.manageGroupIds.length && !notified.notifiedUserIds.length && !notified.masterNotified) {
    logger.warn(`[自动退群] 群 ${groupId} 的留群审核通知未送达，将保留审核并重试通知`)
  }
  return true
}

export async function decideStayReview(review, approve, bot) {
  if (approve !== true && approve !== false) {
    return { ok: false, message: '无法识别审核操作，请重新发送命令' }
  }
  const service = new InviteManagementService({ bot })
  const current = service.getStayReviews().find(item => item.requestId === review.requestId)
  if (!current || current.status !== 'pending' || Date.now() >= current.expiresAt) {
    if (current) await expireStayReview(current, bot)
    return { ok: false, message: '留群审核已过期或正在退群' }
  }
  if (current.reviewType === 'cooldown') return { ok: false, message: '群聊仍在退群冷却期内' }
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
  if (review.status === 'leaving' && !saveReviewCooldown(service, review)) {
    logger.error(`[自动退群] 群 ${review.groupId} 的冷却保存失败，保留审核状态`)
    return false
  }
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
    if (review.status === 'pending' && review.reviewType !== 'cooldown' && !review.noticeSent && Date.now() < review.expiresAt) {
      notifyStayReview(review, bot).catch(err => logger.error(`[自动退群] 重试留群审核通知失败: ${err.message}`))
    }
  }
  const joins = Config.loadConfig().inviteManagement?.pendingJoins || []
  for (const join of joins) {
    const bot = resolveBot(join.botId)
    if (!bot || !new InviteManagementService({ bot }).getPendingJoin(join.groupId)) continue
    if (!(bot.gl instanceof Map) || !(bot.gl.has(join.groupId) || bot.gl.has(Number(join.groupId)))) continue
    const key = `${join.botId}:${join.groupId}`
    if (recoveringJoins.has(key)) continue
    recoveringJoins.add(key)
    import('./index.js')
      .then(({ processGroupJoin }) => processGroupJoin({
        bot, self_id: join.botId, user_id: join.botId, group_id: join.groupId, operator_id: join.userId
      }))
      .catch(err => logger.error(`[自动退群] 恢复入群审核失败: ${err.message}`))
      .finally(() => recoveringJoins.delete(key))
  }
}
