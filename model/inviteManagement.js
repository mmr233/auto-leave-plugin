import { Config, DEFAULT_INVITE_MESSAGES } from '../components/config.js'
import { isApiSuccess, sendGroupMessage, sendPrivateMessage } from '../utils/groupInfo.js'
import {
  callBotApi,
  getBot,
  getGroup,
  getGroupMemberInfo
} from '../utils/groupAdmin.js'
import { getMasterQQ } from '../utils/common.js'
import { findInviteCard } from './inviteCard.js'
import { getInviteShareInfo } from './inviteShare.js'

export const REVIEW_MODE = {
  AUTO_APPROVE: 0,
  DISABLED: 1,
  MANUAL: 2,
  AUTO_REJECT: 3,
  POST_JOIN: 4
}

export const REVIEW_MODE_LABEL = {
  [REVIEW_MODE.AUTO_APPROVE]: '自动同意',
  [REVIEW_MODE.DISABLED]: '关闭不处理',
  [REVIEW_MODE.MANUAL]: '人工审核',
  [REVIEW_MODE.AUTO_REJECT]: '自动拒绝',
  [REVIEW_MODE.POST_JOIN]: '入群后审核'
}

export const PRECHECK_MODE = {
  REJECT: 'reject',
  WARN: 'warn'
}

export const PRECHECK_MODE_LABEL = {
  [PRECHECK_MODE.REJECT]: '低于人数要求时判定失败',
  [PRECHECK_MODE.WARN]: '低于人数要求时仅提示'
}

export const PRECHECK_FAILURE_ACTION = {
  MANUAL: 'manual',
  REJECT: 'reject',
  CONTINUE: 'continue'
}

export const PRECHECK_FAILURE_ACTION_LABEL = {
  [PRECHECK_FAILURE_ACTION.MANUAL]: '转人工审核',
  [PRECHECK_FAILURE_ACTION.REJECT]: '直接拒绝',
  [PRECHECK_FAILURE_ACTION.CONTINUE]: '继续按普通规则处理'
}

const pendingExpiryTimers = new Map()
const inviteNoticeInFlight = new Set()
const pendingDecisions = new Set()
const reconcilingPendingBots = new Set()

export function setInviteNoticeInFlight(request, active) {
  const key = pendingExpiryKey(request)
  if (active) inviteNoticeInFlight.add(key)
  else inviteNoticeInFlight.delete(key)
}

export function isInviteNoticeInFlight(request) {
  return inviteNoticeInFlight.has(pendingExpiryKey(request))
}

export function isPendingDecisionInFlight(request) {
  return pendingDecisions.has(pendingExpiryKey(request))
}

function pendingExpiryKey(request) {
  return `${request.botId}:${request.requestId}`
}

function cancelPendingExpiry(request) {
  const key = pendingExpiryKey(request)
  clearTimeout(pendingExpiryTimers.get(key)?.timer)
  pendingExpiryTimers.delete(key)
}

function schedulePendingExpiry(service, request) {
  const key = pendingExpiryKey(request)
  const deadline = Number(request.requestTime) + service.expireMs
  if (pendingExpiryTimers.get(key)?.deadline === deadline) return
  cancelPendingExpiry(request)
  const timer = setTimeout(() => {
    pendingExpiryTimers.delete(key)
    new InviteManagementService({ bot: service.bot }).cleanExpiredPendingRequests()
  }, Math.max(0, deadline - Date.now()))
  timer.unref?.()
  pendingExpiryTimers.set(key, { deadline, timer })
}

export function reconcilePendingInviteRequests() {
  const requests = normalizePendingRequests(Config.loadConfig().inviteManagement?.pendingRequests)
  for (const botId of new Set(requests.map(item => item.botId).filter(Boolean))) {
    const root = globalThis.Bot
    const bot = root?.[botId] || root
    if (String(bot?.uin || bot?.self_id || '') !== botId || reconcilingPendingBots.has(botId)) continue
    reconcilingPendingBots.add(botId)
    reconcileBotPendingRequests(new InviteManagementService({ bot }))
      .catch(err => logger.error(`[自动退群] 恢复群邀请审核失败: ${err.message}`))
      .finally(() => reconcilingPendingBots.delete(botId))
  }
}

async function reconcileBotPendingRequests(service) {
  const joined = service.getPendingRequests().filter(request =>
    service.isBotAlreadyInGroup(request.groupId) && !isPendingDecisionInFlight(request))
  if (joined.length) {
    const { processGroupJoin } = await import('./index.js')
    for (const request of joined) {
      service.reload()
      if (!service.getPendingRequests().some(item => item.requestId === request.requestId) ||
        isPendingDecisionInFlight(request)) continue
      if (request.legacyNoticeState && !service.isApprovedGroup(request.groupId) &&
        !service.getStayReviews().some(item => item.groupId === request.groupId)) {
        if (service.removePendingRequest(request.requestId)) {
          await service.notifyInviter(request, `机器人已在群 ${request.groupId}，历史邀请审核状态无法确认，已结束旧邀请记录。请以实际群状态为准`)
        }
        continue
      }
      await processGroupJoin({
        bot: service.bot, self_id: service.botId, user_id: service.botId,
        group_id: request.groupId, operator_id: request.userId
      })
    }
  }

  const pending = service.cleanExpiredPendingRequests()
  let systemRequests = null
  if (pending.length) {
    try {
      systemRequests = await getGroupSystemRequests(service.bot)
    } catch (err) {
      logger.debug?.(`[自动退群] 同步群邀请处理状态失败: ${err.message}`)
    }
  }
  service.reload()
  for (const request of service.getPendingRequests()) {
    if (isPendingDecisionInFlight(request) || isInviteNoticeInFlight(request)) continue
    const handled = systemRequests?.entries.some(item => {
      const target = String(item.requester_uin ?? item.requester_id ?? item.target_id ?? '')
      return String(item.group_id ?? item.groupId ?? '') === request.groupId &&
        String(item.flag || '') === request.flag && (target ? target === service.botId : systemRequests.invitedOnly) &&
        (item.checked === true || item.checked === 1)
    })
    if (handled && !service.isBotAlreadyInGroup(request.groupId)) {
      if (service.removePendingRequest(request.requestId)) {
        await service.notifyInviter(request, `群邀请已由 QQ 或其他方式处理\n群号：${request.groupId}\n群名：${request.groupName}\n请以实际群状态为准`)
      }
      continue
    }
    if (!request.noticeSent) {
      recoverPendingNotice(service, request).catch(err => logger.error(`[自动退群] 恢复群邀请通知失败: ${err.message}`))
    }
  }
}

async function recoverPendingNotice(service, request) {
  setInviteNoticeInFlight(request, true)
  try {
    const notified = await service.sendReviewNotifications(request)
    if (!service.recordReviewNotification(request, notified)) return
    if (notified.manageGroupIds.length || notified.notifiedUserIds.length || notified.masterNotified) {
      await service.notifyInviter(request, service.buildInviteeMessage(request, 'inviteSubmitted'))
    } else {
      logger.warn(`[自动退群] 群 ${request.groupId} 的邀请审核通知未送达，将重试`)
    }
  } finally {
    setInviteNoticeInFlight(request, false)
  }
}

function unique(list) {
  return [...new Set(list)]
}

function toId(value) {
  const id = String(value ?? '').trim()
  return /^\d+$/.test(id) ? id : ''
}

function toMemberCount(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : null
}

function firstMemberCount(...values) {
  for (const value of values) {
    const count = toMemberCount(value)
    if (count !== null) {
      return count
    }
  }
  return null
}

export function getBotId(botOrEvent) {
  const bot = getBot(botOrEvent)
  return toId(
    bot?.uin ||
    bot?.self_id ||
    botOrEvent?.self_id ||
    botOrEvent?.bot?.uin ||
    botOrEvent?.bot?.self_id
  )
}

function getEventUserId(value) {
  if (value && typeof value === 'object') {
    return toId(value.user_id ?? value.userId ?? value.qq ?? value.uin ?? value.id)
  }
  return toId(value)
}

export function getInviteTargetId(event = {}) {
  const candidates = [
    event.invited_id,
    event.invitedId,
    event.invitee_id,
    event.inviteeId,
    event.target_user_id,
    event.targetUserId,
    event.target_id,
    event.targetId,
    event.invited,
    event.invitee,
    event.target
  ]

  for (const candidate of candidates) {
    const id = getEventUserId(candidate)
    if (id) {
      return id
    }
  }

  return ''
}

export function isInviteForCurrentBot(event = {}) {
  const targetId = getInviteTargetId(event)
  const botId = getBotId(event)
  return !targetId || !botId || targetId === botId
}

function collectIds(value, keys = ['groupId', 'groupIdInput', 'groupIds', 'manageGroupId', 'userId', 'id']) {
  if (value === undefined || value === null || value === '') {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectIds(item, keys))
  }

  if (typeof value === 'object') {
    if (value.isEnabled === false) {
      return []
    }
    return keys.flatMap(key => collectIds(value[key], keys))
  }

  const id = toId(value)
  return id ? [id] : []
}

export function normalizeIdList(value) {
  return unique(collectIds(value))
}

export function normalizeNotifyUsers(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const users = []
  const seen = new Set()
  for (const item of value) {
    const userId = toId(typeof item === 'object'
      ? (item.userId ?? item.user_id ?? item.value ?? item.id ?? item.qq)
      : item)
    if (!userId || seen.has(userId)) {
      continue
    }
    seen.add(userId)
    users.push({
      userId,
      remark: typeof item === 'object' ? String(item.remark || item.nickname || item.label || '') : ''
    })
  }
  return users
}

function normalizePendingRequests(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(item => {
    const groupId = toId(item.groupId ?? item.group_id)
    const userId = toId(item.userId ?? item.user_id)
    const flag = String(item.flag || '').trim()
    const requestTime = Number(item.requestTime || item.time || Date.now())
    return {
      requestId: String(item.requestId || `${groupId}-${flag || requestTime}`).trim(),
      botId: toId(item.botId ?? item.self_id ?? item.selfId),
      groupId,
      groupName: String(item.groupName || item.group_name || '未知群名'),
      userId,
      nickname: String(item.nickname || '未知用户'),
      flag,
      subType: String(item.subType || item.sub_type || 'invite'),
      msgIds: normalizeIdList(item.msgIds ?? item.msgId),
      manageGroupIds: normalizeIdList(item.manageGroupIds ?? item.manageGroupId),
      noticeSent: typeof item.noticeSent === 'boolean' ? item.noticeSent : true,
      legacyNoticeState: item.legacyNoticeState === true || typeof item.noticeSent !== 'boolean',
      memberCount: firstMemberCount(item.memberCount, item.member_count),
      precheckStatus: String(item.precheckStatus || '').trim(),
      precheckReason: String(item.precheckReason || '').trim(),
      precheckAction: String(item.precheckAction || '').trim(),
      status: String(item.status || (item.precheckStatus === 'failed' ? 'precheck_failed' : 'pending')).trim(),
      requestTime
    }
  }).filter(item => item.groupId && item.flag)
}

function normalizeStayReviews(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => ({
    requestId: String(item.requestId || ''),
    requestIds: Array.isArray(item.requestIds) ? item.requestIds.map(String).filter(Boolean) : [],
    botId: toId(item.botId),
    groupId: toId(item.groupId),
    groupName: String(item.groupName || '未知群名'),
    userId: toId(item.userId),
    nickname: String(item.nickname || '未知用户'),
    memberCount: firstMemberCount(item.memberCount),
    checkedMemberCount: firstMemberCount(item.checkedMemberCount),
    countBasis: String(item.countBasis || ''),
    reviewType: ['post_join', 'cooldown'].includes(item.reviewType) ? item.reviewType : 'low_members',
    cooldownMinutes: item.cooldownMinutes == null ? null : Math.max(0, Number(item.cooldownMinutes) || 0),
    noticeSent: item.noticeSent === true,
    joinObservedAt: Number(item.joinObservedAt) || 0,
    leaveStartedAt: Number(item.leaveStartedAt) || 0,
    leaveReason: String(item.leaveReason || ''),
    requestTime: Number(item.requestTime) || 0,
    expiresAt: Number(item.expiresAt) || 0,
    status: item.status === 'leaving' ? 'leaving' : 'pending',
    msgIds: normalizeIdList(item.msgIds),
    manageGroupIds: normalizeIdList(item.manageGroupIds)
  })).filter(item => item.requestId && item.botId && item.groupId && item.expiresAt > 0)
}

function normalizeStayCooldowns(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => ({
    botId: toId(item?.botId),
    groupId: toId(item?.groupId),
    expiresAt: Number(item?.expiresAt) || 0
  })).filter(item => item.botId && item.groupId && item.expiresAt > 0)
}

function normalizePendingJoins(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => ({
    botId: toId(item?.botId),
    groupId: toId(item?.groupId),
    userId: toId(item?.userId),
    createdAt: Number(item?.createdAt) || 0,
    expiresAt: Number(item?.expiresAt) || 0
  })).filter(item => item.botId && item.groupId && item.createdAt > 0 && item.expiresAt > 0)
}

export function normalizeApprovedGroupStates(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(item => {
    const isObject = item && typeof item === 'object'
    return {
      groupId: toId(isObject ? (item.groupId ?? item.group_id ?? item.id) : item),
      botId: toId(isObject ? (item.botId ?? item.self_id ?? item.selfId) : ''),
      approvedAt: Number(isObject ? item.approvedAt : 0) || 0,
      expiresAt: Number(isObject ? item.expiresAt : 0) || 0,
      source: String(isObject ? item.source || 'manual' : 'legacy').trim()
    }
  }).filter(item => item.groupId)
}

export function getInviteConfig(rootConfig = Config.loadConfig()) {
  const raw = rootConfig.inviteManagement || {}
  const mode = Number(raw.reviewMode)
  const cooldown = raw.stayReviewCooldownMinutes === '' || raw.stayReviewCooldownMinutes == null
    ? 10 : Number(raw.stayReviewCooldownMinutes)

  return {
    enabled: raw.enabled !== false,
    reviewMode: Object.values(REVIEW_MODE).includes(mode) ? mode : REVIEW_MODE.MANUAL,
    requestExpireMinutes: Math.max(1, Number(raw.requestExpireMinutes) || 5),
    notifyInviterOnExpiry: raw.notifyInviterOnExpiry !== false,
    maxPendingRequests: Math.max(1, Number(raw.maxPendingRequests) || 20),
    allowInviterConfirm: raw.allowInviterConfirm !== false,
    notifyGroups: normalizeIdList(raw.notifyGroups),
    notifyUsers: normalizeNotifyUsers(raw.notifyUsers),
    blackGroups: normalizeIdList(raw.blackGroups),
    whiteGroups: normalizeIdList(raw.whiteGroups),
    pendingRequests: normalizePendingRequests(raw.pendingRequests),
    approvedGroups: normalizeIdList(raw.approvedGroups),
    approvedGroupStates: normalizeApprovedGroupStates(raw.approvedGroupStates),
    stayReviews: normalizeStayReviews(raw.stayReviews),
    stayReviewMinutes: Math.max(1, Math.min(1440, Number(raw.stayReviewMinutes) || 10)),
    stayReviewCooldownMinutes: Number.isFinite(cooldown) ? Math.max(0, Math.min(1440, Math.floor(cooldown))) : 10,
    stayReviewCooldowns: normalizeStayCooldowns(raw.stayReviewCooldowns),
    pendingJoins: normalizePendingJoins(raw.pendingJoins),
    precheckMemberCount: raw.precheckMemberCount !== false,
    excludeBotFromPrecheck: raw.excludeBotFromPrecheck !== false,
    precheckMode: Object.values(PRECHECK_MODE).includes(String(raw.precheckMode))
      ? String(raw.precheckMode)
      : PRECHECK_MODE.REJECT,
    precheckFailureAction: Object.values(PRECHECK_FAILURE_ACTION).includes(String(raw.precheckFailureAction))
      ? String(raw.precheckFailureAction)
      : PRECHECK_FAILURE_ACTION.MANUAL,
    notifyMasterOnPrecheckReject: raw.notifyMasterOnPrecheckReject !== false
  }
}

function getApiData(res) {
  return res?.data || res?.response || res || {}
}

function formatTemplate(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

export async function setGroupAddRequest(botOrEvent, request, approve, reason = '') {
  const bot = getBot(botOrEvent)
  const params = {
    flag: request.flag,
    sub_type: request.subType || request.sub_type || 'invite',
    approve: !!approve,
    reason
  }
  const errors = []
  const checkResult = res => {
    if (res === false || res?.status === 'failed' ||
      (res?.retcode !== undefined && ![0, 1].includes(Number(res.retcode)))) {
      throw new Error(res?.message || res?.wording || res?.msg || '协议端返回处理失败')
    }
    return res
  }

  const tryCall = async (label, fn) => {
    try {
      const res = checkResult(await fn())
      logger.debug?.(`[自动退群] ${label} 处理群邀请成功`)
      return res
    } catch (err) {
      errors.push(err)
      logger.debug?.(`[自动退群] ${label} 处理群邀请失败: ${err.message}`)
      return null
    }
  }

  if (typeof bot?.sendApi === 'function') {
    const res = await tryCall('sendApi.set_group_add_request', () => bot.sendApi('set_group_add_request', params))
    if (res !== null) return res
  }

  if (typeof bot?.setGroupAddRequest === 'function') {
    const res = await tryCall('setGroupAddRequest', async () => {
      try {
        return await bot.setGroupAddRequest(params)
      } catch {
        return bot.setGroupAddRequest(params.flag, params.sub_type, params.approve, params.reason)
      }
    })
    if (res !== null) return res
  }

  if (typeof bot?.set_group_add_request === 'function') {
    const res = await tryCall('set_group_add_request', () => bot.set_group_add_request(params))
    if (res !== null) return res
  }

  if (typeof request?.event?.approve === 'function') {
    const res = await tryCall('event.approve', () => request.event.approve(!!approve))
    if (res !== null) return res
  }

  try {
    return checkResult(await callBotApi(bot, 'set_group_add_request', params))
  } catch (err) {
    errors.push(err)
  }

  throw errors[0] || new Error('当前协议端不支持处理群邀请')
}

export async function getGroupSystemRequests(bot) {
  if (typeof bot?.sendApi !== 'function' && typeof bot?.get_group_system_msg !== 'function') return null
  let timer
  try {
    const response = await Promise.race([
      callBotApi(bot, 'get_group_system_msg', {}),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); timer.unref?.() })
    ])
    if (!response || !isApiSuccess(response)) return null
    const data = response.data ?? response.response ?? response
    if (Array.isArray(data)) return { entries: data, invitedOnly: false }
    if (Array.isArray(data?.invited_requests)) return { entries: data.invited_requests, invitedOnly: true }
    return null
  } finally {
    clearTimeout(timer)
  }
}

export class InviteManagementService {
  constructor(e = null) {
    this.e = e
    this.bot = getBot(e)
    this.botId = getBotId(e)
    this.reload()
    this.migrateLegacyApprovedGroups()
  }

  reload() {
    this.rootConfig = Config.loadConfig()
    this.config = getInviteConfig(this.rootConfig)
  }

  migrateLegacyApprovedGroups() {
    if (!this.botId || this.config.approvedGroups.length === 0) {
      return false
    }

    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const states = normalizeApprovedGroupStates(rootConfig.inviteManagement.approvedGroupStates)
    const now = Date.now()
    for (const groupId of normalizeIdList(rootConfig.inviteManagement.approvedGroups)) {
      if (states.some(item => item.groupId === groupId && item.botId === this.botId)) {
        continue
      }
      states.push({
        groupId,
        botId: this.botId,
        approvedAt: now,
        expiresAt: now + this.approvedGroupExpireMs,
        source: 'legacy'
      })
    }

    rootConfig.inviteManagement.approvedGroupStates = states
    rootConfig.inviteManagement.approvedGroups = []
    Config.saveConfig(rootConfig)
    this.reload()
    logger.info(`[自动退群] 已将 ${states.length} 条旧版邀请批准状态迁移到 Bot ${this.botId}`)
    return true
  }

  get expireMs() {
    return this.config.requestExpireMinutes * 60 * 1000
  }

  get approvedGroupExpireMs() {
    return Math.max(this.expireMs, 30 * 60 * 1000)
  }

  get inviteMessages() {
    const messages = this.rootConfig?.inviteMessages
    return {
      ...DEFAULT_INVITE_MESSAGES,
      ...(messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {})
    }
  }

  get allBlackGroups() {
    return unique([
      ...this.config.blackGroups,
      ...Config.getBlacklist().map(item => String(item))
    ])
  }

  get allWhiteGroups() {
    return unique([
      ...this.config.whiteGroups,
      ...Config.getWhitelist().map(item => String(item))
    ])
  }

  isBlackGroup(groupId) {
    return this.allBlackGroups.includes(String(groupId))
  }

  isWhiteGroup(groupId) {
    return this.allWhiteGroups.includes(String(groupId))
  }

  createRequestInfo(e, groupInfo, userInfo) {
    const groupId = toId(e.group_id ?? e.groupId)
    const userId = toId(e.user_id ?? e.operator_id ?? e.inviter_id)
    const flagPart = String(e.flag || '').replace(/[^a-z0-9]/gi, '').slice(-8)
    const requestId = `${this.botId || 'bot'}-${Date.now().toString(36)}-${flagPart || String(groupId).slice(-4)}`
    return {
      requestId,
      botId: this.botId,
      groupId,
      groupName: groupInfo.groupName || '未知群名',
      userId,
      nickname: userInfo.nickname || '未知用户',
      memberCount: firstMemberCount(groupInfo.memberCount),
      precheckStatus: '',
      precheckReason: '',
      precheckAction: '',
      status: 'pending',
      flag: String(e.flag || ''),
      subType: String(e.sub_type || e.subType || 'invite'),
      msgIds: [],
      manageGroupIds: [],
      requestTime: Date.now()
    }
  }

  getTemplateVars(request = {}, extra = {}) {
    const memberCount = firstMemberCount(request.memberCount, request.member_count)
    const expiresAt = Number(request.expiresAt) || (request.requestTime ? Number(request.requestTime) + this.expireMs : 0)
    return {
      groupId: request.groupId || request.group_id || '',
      groupName: request.groupName || request.group_name || '未知群名',
      userId: request.userId || request.user_id || '',
      nickname: request.nickname || '未知用户',
      requestId: request.requestId || '',
      expireMinutes: expiresAt ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000)) : this.config.requestExpireMinutes,
      deadline: request.expiresAt
        ? new Date(request.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '',
      reviewMode: REVIEW_MODE_LABEL[this.config.reviewMode] || '',
      memberCount: memberCount === null ? '未知' : memberCount,
      checkedMemberCount: request.checkedMemberCount == null ? '未知' : request.checkedMemberCount,
      countBasis: request.countBasis || '人数未知',
      cooldownMinutes: request.cooldownMinutes ?? this.config.stayReviewCooldownMinutes,
      minMemberCount: Number(this.rootConfig?.minMemberCount) || 0,
      precheckReason: request.precheckReason || '',
      precheckAction: PRECHECK_FAILURE_ACTION_LABEL[request.precheckAction] || '',
      precheckNotice: ['failed', 'warning'].includes(request.precheckStatus)
        ? `预检查提示：${request.precheckReason || '未达到人数要求或无法获取群人数'}${request.precheckAction ? `，处理方式：${PRECHECK_FAILURE_ACTION_LABEL[request.precheckAction] || request.precheckAction}` : ''}`
        : '',
      error: '',
      ...extra
    }
  }

  formatInviteMessage(key, request = {}, extra = {}) {
    const fallback = DEFAULT_INVITE_MESSAGES[key] || ''
    const current = this.inviteMessages[key]
    const template = String(current ?? '').trim() ? current : fallback
    return formatTemplate(template || fallback, this.getTemplateVars(request, extra))
  }

  buildReviewMessage(request) {
    return this.formatInviteMessage('reviewNotification', request)
  }

  buildInviteeMessage(request, templateKey = 'inviteSubmitted') {
    return this.formatInviteMessage(templateKey, request)
  }

  buildResultMessage(request, approve) {
    return this.formatInviteMessage(approve ? 'resultApproved' : 'resultRejected', request)
  }

  buildPrecheckMessage(request) {
    return this.formatInviteMessage('precheckRejected', request)
  }

  evaluatePrecheck(groupInfo = {}) {
    if (!this.config.precheckMemberCount) {
      return {
        status: 'skipped',
        passed: true,
        memberCount: firstMemberCount(groupInfo.memberCount)
      }
    }

    const memberCount = firstMemberCount(groupInfo.memberCount)
    const checkedCount = memberCount === null
      ? null
      : memberCount + (this.config.excludeBotFromPrecheck ? 0 : 1)
    const countLabel = this.config.excludeBotFromPrecheck ? '群成员数量' : '机器人入群后预计群成员数量'
    const minMemberCount = Math.max(0, Number(this.rootConfig?.minMemberCount) || 0)

    if (this.config.precheckMode === PRECHECK_MODE.WARN) {
      return {
        status: 'warning',
        passed: true,
        memberCount,
        minMemberCount,
        reason: memberCount === null
          ? '无法获取群成员数量，仅记录提示'
          : checkedCount < minMemberCount
            ? `${countLabel} ${checkedCount}，低于要求 ${minMemberCount}`
            : ''
      }
    }

    if (memberCount === null) {
      return {
        status: 'failed',
        passed: false,
        memberCount: null,
        minMemberCount,
        reason: '无法获取群成员数量'
      }
    }

    if (checkedCount < minMemberCount) {
      return {
        status: 'failed',
        passed: false,
        memberCount,
        minMemberCount,
        reason: `${countLabel} ${checkedCount}，低于要求 ${minMemberCount}`
      }
    }

    return {
      status: 'passed',
      passed: true,
      memberCount,
      minMemberCount,
      reason: ''
    }
  }

  async getGroupInfo(groupId, event = null) {
    const cardEvent = event ? { self_id: event.self_id || this.botId, user_id: event.cardSenderId || event.user_id } : null
    let groupName = event?.group_name || event?.groupName || findInviteCard(cardEvent, groupId)?.groupName || '未知群名'
    const eventMemberCount = firstMemberCount(event?.member_count, event?.memberCount)
    const result = async memberCount => {
      if ((!groupName || groupName === '未知群名') && event?.flag && event?.user_id) {
        let card = findInviteCard(cardEvent, groupId)
        if (!card) {
          await new Promise(resolve => setTimeout(resolve, 500))
          card = findInviteCard(cardEvent, groupId)
        }
        groupName = card?.groupName || groupName
      }
      return { groupId: String(groupId), groupName: groupName || '未知群名', memberCount }
    }

    const readResponse = res => {
      if (res?.status === 'failed' || (res?.retcode !== undefined && Number(res.retcode) !== 0)) {
        throw new Error(res?.message || '接口返回失败')
      }
      const data = getApiData(res)
      const info = data.groupInfo || data.group_info || {}
      const responseId = toId(data.group_id ?? data.groupId ?? data.groupCode ?? data.group_code ?? info.group_id ?? info.groupId ?? info.groupCode)
      if (responseId && responseId !== String(groupId)) return null
      groupName = data.group_name || data.groupName || data.name || info.group_name || info.groupName || groupName
      return firstMemberCount(data.member_count, data.memberCount, data.memberNum, info.member_count, info.memberCount, info.memberNum)
    }

    for (const noCache of [true, false]) {
      try {
        const res = await callBotApi(this.bot, 'get_group_info', {
          group_id: Number(groupId),
          no_cache: noCache
        })
        const memberCount = readResponse(res)
        if (memberCount > 0) return result(memberCount)
      } catch (err) {
        logger.debug?.(`[自动退群] 获取邀请群信息失败 (no_cache=${noCache}): ${err.message}`)
      }
    }

    try {
      const group = getGroup(this.bot, groupId)
      const info = group?.info || group
      const memberCount = firstMemberCount(info?.member_count, info?.memberCount)
      groupName = info?.group_name || info?.groupName || info?.name || groupName
      if (memberCount > 0) return result(memberCount)
    } catch (err) {
      logger.debug?.(`[自动退群] 读取邀请群缓存失败: ${err.message}`)
    }

    if (eventMemberCount > 0) return result(eventMemberCount)

    for (const action of ['get_group_detail_info', 'get_group_info_ex']) {
      try {
        const memberCount = readResponse(await callBotApi(this.bot, action, { group_id: Number(groupId) }))
        if (memberCount > 0) return result(memberCount)
      } catch (err) {
        logger.debug?.(`[自动退群] 获取邀请群详细信息失败 (${action}): ${err.message}`)
      }
    }
    const share = await getInviteShareInfo(cardEvent, groupId)
    if (share) {
      if (!groupName || groupName === '未知群名') groupName = share.groupName || groupName
      if (share.memberCount > 0) return result(share.memberCount)
    }
    return result(null)
  }

  isBotAlreadyInGroup(groupId) {
    if (this.bot?.gl instanceof Map) {
      return this.bot.gl.has(String(groupId)) || this.bot.gl.has(Number(groupId))
    }
    const info = getGroup(this.bot, groupId)?.info
    return !!info && String(info.group_id ?? info.groupId ?? '') === String(groupId)
  }

  async getUserInfo(userId) {
    try {
      const res = await callBotApi(this.bot, 'get_stranger_info', {
        user_id: Number(userId),
        no_cache: false
      })
      const data = getApiData(res)
      return {
        userId: String(data.user_id || userId),
        nickname: data.nickname || data.nick || '未知用户'
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 获取邀请人信息失败: ${err.message}`)
    }

    try {
      const friend = this.bot?.pickFriend?.(Number(userId) || userId)
      const info = friend?.info || await friend?.getInfo?.()
      return {
        userId: String(userId),
        nickname: info?.nickname || info?.nick || '未知用户'
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 读取邀请人缓存失败: ${err.message}`)
    }

    return {
      userId: String(userId),
      nickname: '未知用户'
    }
  }

  async getMessageText(messageId) {
    if (!messageId) {
      return ''
    }

    try {
      const res = await callBotApi(this.bot, 'get_msg', {
        message_id: Number(messageId) || messageId
      })
      const data = getApiData(res)
      const message = data.message || []
      if (Array.isArray(message)) {
        return message.map(item => item?.data?.text || item?.text || '').join('')
      }
      return String(message || data.raw_message || data.rawMessage || '')
    } catch (err) {
      logger.debug?.(`[自动退群] 获取引用消息失败: ${err.message}`)
      return ''
    }
  }

  async sendReviewNotifications(request) {
    const message = request.kind === 'stay'
      ? this.formatInviteMessage(request.reviewType === 'post_join' ? 'postJoinReviewNotification' : 'stayReviewNotification', request)
      : this.buildReviewMessage(request)
    const msgIds = []
    const manageGroupIds = []

    for (const groupId of this.config.notifyGroups) {
      try {
        const res = await sendGroupMessage(this.bot, Number(groupId) || groupId, message)
        const messageId = res?.message_id || res?.data?.message_id || res?.response?.message_id
        if (messageId) {
          msgIds.push(String(messageId))
        }
        if (isApiSuccess(res)) {
          manageGroupIds.push(String(groupId))
        }
      } catch (err) {
        logger.error(`[自动退群] 发送群邀请审核通知失败，群 ${groupId}: ${err.message}`)
      }
    }

    const notifiedUserIds = await this.notifyUsers(message, [request.userId])

    let masterNotified = false
    if (request.kind === 'stay' || (request.precheckStatus === 'failed' && this.config.notifyMasterOnPrecheckReject)) {
      masterNotified = await this.notifyMaster(request.kind === 'stay' ? message : this.buildPrecheckMessage(request))
    }

    return {
      ...request,
      msgIds,
      manageGroupIds,
      notifiedUserIds,
      masterNotified
    }
  }

  async notifyUsers(message, exclude = []) {
    const excludeSet = new Set(exclude.map(item => String(item)))
    const notified = []
    for (const user of this.config.notifyUsers) {
      if (!user.userId || excludeSet.has(String(user.userId))) {
        continue
      }
      if (await sendPrivateMessage(this.bot, Number(user.userId) || user.userId, message)) {
        notified.push(user.userId)
      }
    }
    return notified
  }

  async notifyInviter(request, message) {
    if (!request.userId) {
      return false
    }
    return sendPrivateMessage(this.bot, Number(request.userId) || request.userId, message)
  }

  async notifyExpiredInvite(request) {
    let message = this.formatInviteMessage('inviteExpired', request)
    if (this.isBotAlreadyInGroup(request.groupId)) {
      message = `群邀请审核已结束\n群号：${request.groupId}\n群名：${request.groupName}\n机器人已入群，原邀请不再等待处理`
    } else {
      try {
        const result = await getGroupSystemRequests(this.bot)
        if (result?.entries.some(item => String(item.flag || '') === request.flag &&
          String(item.group_id ?? item.groupId ?? '') === request.groupId && (item.checked === true || item.checked === 1))) {
          message = `群邀请审核已结束\n群号：${request.groupId}\n群名：${request.groupName}\nQQ 已处理此邀请，请以实际群状态为准`
        }
      } catch (err) {
        logger.debug?.(`[自动退群] 检查邀请处理状态失败: ${err.message}`)
      }
    }
    return this.notifyInviter(request, message)
  }

  async notifyMaster(message) {
    const botId = this.bot?.uin || this.bot?.self_id
    const masterQQ = getMasterQQ(botId)
    if (!masterQQ) {
      return false
    }
    return sendPrivateMessage(this.bot, Number(masterQQ) || masterQQ, message)
  }

  filterPending(pending) {
    const now = Date.now()
    return pending.filter(item => pendingDecisions.has(pendingExpiryKey({ ...item, botId: item.botId || this.botId })) ||
      now - Number(item.requestTime || 0) <= this.expireMs)
  }

  belongsToCurrentBot(item) {
    return !item.botId || (!!this.botId && String(item.botId) === String(this.botId))
  }

  getPendingRequests() {
    return this.config.pendingRequests.filter(item => this.belongsToCurrentBot(item))
  }

  savePendingRequests(pending) {
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const allPending = normalizePendingRequests(rootConfig.inviteManagement.pendingRequests)
    const otherBotPending = allPending.filter(item => !this.belongsToCurrentBot(item))
    const currentPending = pending.map(item => ({
      ...item,
      botId: item.botId || this.botId
    }))
    rootConfig.inviteManagement.pendingRequests = [...otherBotPending, ...currentPending]
    const saved = Config.saveConfig(rootConfig)
    this.reload()
    return saved
  }

  cleanExpiredPendingRequests() {
    this.reload()
    const currentPending = this.getPendingRequests()
    const pending = this.filterPending(currentPending)
    const needsBotMigration = currentPending.some(item => !item.botId && this.botId)
    if (pending.length !== currentPending.length || needsBotMigration) {
      if (!this.savePendingRequests(pending)) return currentPending
    }
    const remaining = new Set(pending.map(item => item.requestId))
    for (const request of currentPending) {
      if (remaining.has(request.requestId)) continue
      cancelPendingExpiry({ ...request, botId: request.botId || this.botId })
    }
    for (const request of pending) {
      const current = request.botId ? request : { ...request, botId: this.botId }
      if (!pendingDecisions.has(pendingExpiryKey(current))) schedulePendingExpiry(this, current)
    }
    if (this.config.notifyInviterOnExpiry) {
      for (const request of currentPending) {
        if (remaining.has(request.requestId)) continue
        this.notifyExpiredInvite(request)
          .then(sent => {
            if (!sent) logger.warn(`[自动退群] 无法向邀请者发送群 ${request.groupId} 的审核到期通知`)
          })
          .catch(err => logger.error(`[自动退群] 发送群邀请审核到期通知失败: ${err.message}`))
      }
    }
    return pending
  }

  addPendingRequest(request) {
    const pending = this.cleanExpiredPendingRequests()
    if (pending.some(item => item.flag === request.flag)) return false

    while (pending.length >= this.config.maxPendingRequests) {
      const removed = pending.shift()
      cancelPendingExpiry({ ...removed, botId: removed.botId || this.botId })
    }

    pending.push({
      ...request,
      botId: request.botId || this.botId,
      noticeSent: request.noticeSent ?? (normalizeIdList(request.manageGroupIds ?? request.manageGroupId).length > 0 ||
        normalizeIdList(request.notifiedUserIds).length > 0 || request.masterNotified === true),
      status: request.status || (request.precheckStatus === 'failed' ? 'precheck_failed' : 'pending')
    })
    if (!this.savePendingRequests(pending)) return false
    schedulePendingExpiry(this, pending.at(-1))
    return true
  }

  recordReviewNotification(request, notified) {
    const root = Config.loadConfig()
    const pending = normalizePendingRequests(root.inviteManagement.pendingRequests)
    const reviews = normalizeStayReviews(root.inviteManagement.stayReviews)
    const current = pending.find(item => this.belongsToCurrentBot(item) && item.requestId === request.requestId) ||
      reviews.find(item => item.botId === this.botId &&
        (item.requestId === request.requestId || item.requestIds.includes(request.requestId)))
    if (!current) return false
    current.msgIds = [...new Set([...current.msgIds, ...notified.msgIds])]
    current.manageGroupIds = [...new Set([...current.manageGroupIds, ...notified.manageGroupIds])]
    current.noticeSent = current.noticeSent || notified.manageGroupIds.length > 0 || notified.notifiedUserIds.length > 0 || notified.masterNotified
    root.inviteManagement.pendingRequests = pending
    root.inviteManagement.stayReviews = reviews
    const saved = Config.saveConfig(root)
    this.reload()
    return saved
  }

  findPendingRequests({ msgId = '', groupId = '', requestId = '' } = {}) {
    const pending = this.cleanExpiredPendingRequests()
    const msg = String(msgId || '')
    const group = String(groupId || '')
    const reqId = String(requestId || '').trim()

    const matched = pending.filter(item => {
      if (reqId) return item.requestId === reqId
      if (msg) return (item.msgIds || []).map(String).includes(msg)
      return !!group && String(item.groupId) === group
    })

    return matched.sort((a, b) => Number(b.requestTime) - Number(a.requestTime))
  }

  findPendingRequest(criteria = {}) {
    return this.findPendingRequests(criteria)[0] || null
  }

  removePendingRequest(requestId) {
    this.reload()
    const pending = this.getPendingRequests().filter(item => item.requestId !== requestId)
    if (!this.savePendingRequests(pending)) return false
    cancelPendingExpiry({ botId: this.botId, requestId })
    return true
  }

  resolvePendingGroup(groupId) {
    this.reload()
    const pending = this.getPendingRequests()
    const resolved = pending.filter(item => item.groupId === String(groupId))
    if (!resolved.length) return []
    if (!this.savePendingRequests(pending.filter(item => item.groupId !== String(groupId)))) return null
    for (const item of resolved) cancelPendingExpiry({ ...item, botId: item.botId || this.botId })
    return resolved
  }

  claimPendingRequest(requestId) {
    const pending = this.cleanExpiredPendingRequests()
    const request = pending.find(item => item.requestId === requestId)
    if (!request) return false
    const current = { ...request, botId: request.botId || this.botId }
    const key = pendingExpiryKey(current)
    if (pending.some(item => item.groupId === current.groupId &&
      pendingDecisions.has(pendingExpiryKey({ ...item, botId: item.botId || this.botId })))) return false
    pendingDecisions.add(key)
    cancelPendingExpiry(current)
    return true
  }

  releasePendingRequest(requestId) {
    pendingDecisions.delete(pendingExpiryKey({ botId: this.botId, requestId }))
    this.cleanExpiredPendingRequests()
  }

  getStayReviews() {
    return this.config.stayReviews.filter(item => item.botId === this.botId)
  }

  findStayReviews({ msgId = '', groupId = '', requestId = '' } = {}) {
    const reviews = this.getStayReviews().filter(item => item.status === 'pending')
    if (requestId) return reviews.filter(item => item.requestId === String(requestId) || item.requestIds.includes(String(requestId)))
    if (msgId) return reviews.filter(item => item.msgIds.includes(String(msgId)))
    return groupId ? reviews.filter(item => item.groupId === String(groupId)) : []
  }

  saveStayReview(review, { promotePending = false } = {}) {
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const reviews = normalizeStayReviews(rootConfig.inviteManagement.stayReviews)
      .filter(item => !(item.botId === review.botId && item.groupId === review.groupId))
    rootConfig.inviteManagement.stayReviews = [...reviews, review]
    const pending = normalizePendingRequests(rootConfig.inviteManagement.pendingRequests)
    const promoted = promotePending
      ? pending.filter(item => this.belongsToCurrentBot(item) && item.groupId === String(review.groupId))
      : []
    if (promotePending) rootConfig.inviteManagement.pendingRequests = pending.filter(item => !promoted.includes(item))
    const saved = Config.saveConfig(rootConfig)
    if (saved) for (const item of promoted) cancelPendingExpiry({ ...item, botId: item.botId || this.botId })
    this.reload()
    return saved
  }

  removeStayReview(review) {
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const reviews = normalizeStayReviews(rootConfig.inviteManagement.stayReviews)
    rootConfig.inviteManagement.stayReviews = reviews.filter(item => !(item.botId === review.botId && item.requestId === review.requestId))
    const pending = normalizePendingRequests(rootConfig.inviteManagement.pendingRequests)
    const obsolete = pending.filter(item => this.belongsToCurrentBot(item) && item.groupId === String(review.groupId))
    rootConfig.inviteManagement.pendingRequests = pending.filter(item => !obsolete.includes(item))
    const saved = Config.saveConfig(rootConfig)
    if (saved) for (const item of obsolete) cancelPendingExpiry({ ...item, botId: item.botId || this.botId })
    this.reload()
    return saved
  }

  getStayCooldown(groupId) {
    const now = Date.now()
    return this.config.stayReviewCooldowns.find(item => item.botId === this.botId &&
      item.groupId === String(groupId) && item.expiresAt > now) || null
  }

  setStayCooldown(groupId, minutes) {
    const target = toId(groupId)
    if (!target || !this.botId || minutes <= 0) return false
    const root = Config.loadConfig()
    const now = Date.now()
    const cooldowns = normalizeStayCooldowns(root.inviteManagement.stayReviewCooldowns)
      .filter(item => item.expiresAt > now && !(item.botId === this.botId && item.groupId === target))
    cooldowns.push({ botId: this.botId, groupId: target, expiresAt: now + minutes * 60000 })
    root.inviteManagement.stayReviewCooldowns = cooldowns
    const saved = Config.saveConfig(root)
    this.reload()
    return saved
  }

  clearStayCooldown(groupId) {
    const root = Config.loadConfig()
    const now = Date.now()
    const cooldowns = normalizeStayCooldowns(root.inviteManagement.stayReviewCooldowns)
    root.inviteManagement.stayReviewCooldowns = cooldowns.filter(item => item.expiresAt > now &&
      !(item.botId === this.botId && item.groupId === String(groupId)))
    const saved = Config.saveConfig(root)
    this.reload()
    return saved
  }

  savePendingJoin(groupId, userId) {
    const target = toId(groupId)
    if (!target || !this.botId) return null
    const root = Config.loadConfig()
    const now = Date.now()
    const joins = normalizePendingJoins(root.inviteManagement.pendingJoins)
      .filter(item => item.expiresAt > now && !(item.botId === this.botId && item.groupId === target))
    const join = { botId: this.botId, groupId: target, userId: toId(userId), createdAt: now, expiresAt: now + 30 * 60000 }
    root.inviteManagement.pendingJoins = [...joins, join]
    if (!Config.saveConfig(root)) return null
    this.reload()
    return join
  }

  getPendingJoin(groupId) {
    return this.config.pendingJoins.find(item => item.botId === this.botId &&
      item.groupId === String(groupId) && item.expiresAt > Date.now()) || null
  }

  removePendingJoin(join) {
    const root = Config.loadConfig()
    const joins = normalizePendingJoins(root.inviteManagement.pendingJoins)
    root.inviteManagement.pendingJoins = joins.filter(item => !(item.botId === join.botId &&
      item.groupId === join.groupId && item.createdAt === join.createdAt))
    const saved = Config.saveConfig(root)
    this.reload()
    return saved
  }

  cleanExpiredApprovedGroups() {
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const states = normalizeApprovedGroupStates(rootConfig.inviteManagement.approvedGroupStates)
    const now = Date.now()
    const next = states.filter(item => !item.expiresAt || item.expiresAt > now)
    if (next.length !== states.length) {
      rootConfig.inviteManagement.approvedGroupStates = next
      Config.saveConfig(rootConfig)
      this.reload()
    }
    return next
  }

  isCurrentBotApprovedState(item) {
    return !item.botId || (!!this.botId && String(item.botId) === String(this.botId))
  }

  getApprovedGroupIds() {
    this.cleanExpiredApprovedGroups()
    return unique([
      ...this.config.approvedGroups,
      ...this.config.approvedGroupStates
        .filter(item => this.isCurrentBotApprovedState(item))
        .map(item => item.groupId)
    ])
  }

  isApprovedGroup(groupId) {
    return this.getApprovedGroupIds().includes(String(groupId))
  }

  markApprovedGroup(groupId) {
    const target = toId(groupId)
    if (!target) {
      return false
    }

    this.cleanExpiredApprovedGroups()
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const states = normalizeApprovedGroupStates(rootConfig.inviteManagement.approvedGroupStates)
    const exists = states.some(item => (
      item.groupId === target && this.isCurrentBotApprovedState(item)
    ))
    if (!exists) {
      const now = Date.now()
      states.push({
        groupId: target,
        botId: this.botId,
        approvedAt: now,
        expiresAt: now + this.approvedGroupExpireMs,
        source: 'manual'
      })
      rootConfig.inviteManagement.approvedGroupStates = states
      if (!Config.saveConfig(rootConfig)) return false
    }
    this.reload()
    return true
  }

  removeApprovedGroup(groupId, { removeLegacy = false } = {}) {
    const target = toId(groupId)
    if (!target) {
      return false
    }

    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const states = normalizeApprovedGroupStates(rootConfig.inviteManagement.approvedGroupStates)
    const nextStates = states.filter(item => !(
      item.groupId === target && this.isCurrentBotApprovedState(item)
    ))
    const legacy = normalizeIdList(rootConfig.inviteManagement.approvedGroups)
    const nextLegacy = removeLegacy ? legacy.filter(item => item !== target) : legacy
    if (nextStates.length !== states.length || nextLegacy.length !== legacy.length) {
      rootConfig.inviteManagement.approvedGroupStates = nextStates
      rootConfig.inviteManagement.approvedGroups = nextLegacy
      Config.saveConfig(rootConfig)
    }
    this.reload()
    return nextStates.length !== states.length || nextLegacy.length !== legacy.length
  }

  consumeApprovedGroup(groupId) {
    return this.removeApprovedGroup(groupId, { removeLegacy: true })
  }

  async canHandleRequest(e, request) {
    const userId = String(e.user_id || '')
    if (e.isMaster) {
      return true
    }

    if (this.config.notifyUsers.some(user => String(user.userId) === userId)) {
      return true
    }

    if (this.config.allowInviterConfirm && userId && userId === String(request.userId)) {
      return true
    }

    const currentGroupId = String(e.group_id || '')
    if (!currentGroupId || !(request.manageGroupIds || []).map(String).includes(currentGroupId)) {
      return false
    }

    let role = e.sender?.role || e.member?.role || ''
    if (!role) {
      const info = await getGroupMemberInfo(e, currentGroupId, userId)
      role = info?.role || ''
    }

    return role === 'owner' || role === 'admin'
  }

  async approvePendingRequest(request, approve, reason = '', { rememberApproval = true } = {}) {
    const hadApproval = this.isApprovedGroup(request.groupId)
    if (approve && rememberApproval && !hadApproval) {
      if (!this.markApprovedGroup(request.groupId)) throw new Error('无法保存本次批准状态，未向协议端提交同意')
    }

    try {
      await setGroupAddRequest(this.bot, request, approve, reason)
    } catch (err) {
      if (approve && rememberApproval && !hadApproval) {
        this.removeApprovedGroup(request.groupId)
      }
      throw err
    }
  }

  async approveCurrentEvent(e, approve, reason = '', { rememberApproval = false } = {}) {
    await setGroupAddRequest(this.bot, {
      flag: e.flag,
      subType: e.sub_type || e.subType || 'invite',
      event: e
    }, approve, reason)

    if (approve && rememberApproval) {
      this.markApprovedGroup(e.group_id)
    }
  }

  updateGroupList(key, groupId, action) {
    const target = toId(groupId)
    if (!target) {
      return { ok: false, message: '群号格式不正确' }
    }

    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    const list = normalizeIdList(rootConfig.inviteManagement[key])
    const exists = list.includes(target)

    if (action === 'add') {
      if (exists) {
        return { ok: true, message: `群 ${target} 已在列表中` }
      }
      rootConfig.inviteManagement[key] = [...list, target]
      Config.saveConfig(rootConfig)
      this.reload()
      return { ok: true, message: `已添加群 ${target}` }
    }

    if (!exists) {
      return { ok: true, message: `群 ${target} 不在列表中` }
    }

    rootConfig.inviteManagement[key] = list.filter(item => item !== target)
    Config.saveConfig(rootConfig)
    this.reload()
    return { ok: true, message: `已删除群 ${target}` }
  }

  setReviewMode(mode) {
    const nextMode = Number(mode)
    if (!Object.values(REVIEW_MODE).includes(nextMode)) {
      return false
    }
    const rootConfig = Config.loadConfig()
    rootConfig.inviteManagement = rootConfig.inviteManagement || {}
    rootConfig.inviteManagement.reviewMode = nextMode
    Config.saveConfig(rootConfig)
    this.reload()
    return true
  }
}
