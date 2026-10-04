import { Config, DEFAULT_INVITE_MESSAGES } from '../components/config.js'
import { sendGroupMessage, sendPrivateMessage } from '../utils/groupInfo.js'
import {
  callBotApi,
  getBot,
  getGroup,
  getGroupMemberInfo
} from '../utils/groupAdmin.js'
import { getMasterQQ } from '../utils/common.js'

export const REVIEW_MODE = {
  AUTO_APPROVE: 0,
  DISABLED: 1,
  MANUAL: 2,
  AUTO_REJECT: 3
}

export const REVIEW_MODE_LABEL = {
  [REVIEW_MODE.AUTO_APPROVE]: '自动同意',
  [REVIEW_MODE.DISABLED]: '关闭不处理',
  [REVIEW_MODE.MANUAL]: '人工审核',
  [REVIEW_MODE.AUTO_REJECT]: '自动拒绝'
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

function unique(list) {
  return [...new Set(list)]
}

function toId(value) {
  const id = String(value ?? '').trim()
  return /^\d+$/.test(id) ? id : ''
}

function toMemberCount(value) {
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
      memberCount: firstMemberCount(item.memberCount, item.member_count),
      precheckStatus: String(item.precheckStatus || '').trim(),
      precheckReason: String(item.precheckReason || '').trim(),
      precheckAction: String(item.precheckAction || '').trim(),
      status: String(item.status || (item.precheckStatus === 'failed' ? 'precheck_failed' : 'pending')).trim(),
      requestTime
    }
  }).filter(item => item.groupId && item.flag)
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

  return {
    enabled: raw.enabled !== false,
    reviewMode: Object.values(REVIEW_MODE).includes(mode) ? mode : REVIEW_MODE.MANUAL,
    requestExpireMinutes: Math.max(1, Number(raw.requestExpireMinutes) || 5),
    maxPendingRequests: Math.max(1, Number(raw.maxPendingRequests) || 20),
    allowInviterConfirm: raw.allowInviterConfirm !== false,
    notifyGroups: normalizeIdList(raw.notifyGroups),
    notifyUsers: normalizeNotifyUsers(raw.notifyUsers),
    blackGroups: normalizeIdList(raw.blackGroups),
    whiteGroups: normalizeIdList(raw.whiteGroups),
    pendingRequests: normalizePendingRequests(raw.pendingRequests),
    approvedGroups: normalizeIdList(raw.approvedGroups),
    approvedGroupStates: normalizeApprovedGroupStates(raw.approvedGroupStates),
    precheckMemberCount: raw.precheckMemberCount !== false,
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

  const tryCall = async (label, fn) => {
    try {
      const res = await fn()
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
    return await callBotApi(bot, 'set_group_add_request', params)
  } catch (err) {
    errors.push(err)
  }

  throw errors[0] || new Error('当前协议端不支持处理群邀请')
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
    return {
      groupId: request.groupId || request.group_id || '',
      groupName: request.groupName || request.group_name || '未知群名',
      userId: request.userId || request.user_id || '',
      nickname: request.nickname || '未知用户',
      requestId: request.requestId || '',
      expireMinutes: this.config.requestExpireMinutes,
      reviewMode: REVIEW_MODE_LABEL[this.config.reviewMode] || '',
      memberCount: memberCount === null ? '未知' : memberCount,
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
    const minMemberCount = Math.max(0, Number(this.rootConfig?.minMemberCount) || 0)

    if (this.config.precheckMode === PRECHECK_MODE.WARN) {
      return {
        status: 'warning',
        passed: true,
        memberCount,
        minMemberCount,
        reason: memberCount === null
          ? '无法获取群成员数量，仅记录提示'
          : memberCount < minMemberCount
            ? `群成员数量 ${memberCount}，低于要求 ${minMemberCount}`
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

    if (memberCount < minMemberCount) {
      return {
        status: 'failed',
        passed: false,
        memberCount,
        minMemberCount,
        reason: `群成员数量 ${memberCount}，低于要求 ${minMemberCount}`
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
    try {
      const res = await callBotApi(this.bot, 'get_group_info', {
        group_id: Number(groupId),
        no_cache: true
      })
      const data = getApiData(res)
      return {
        groupId: String(data.group_id || groupId),
        groupName: data.group_name || data.groupName || data.name || event?.group_name || '未知群名',
        memberCount: firstMemberCount(data.member_count, data.memberCount, event?.member_count, event?.memberCount)
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 获取邀请群信息失败: ${err.message}`)
    }

    try {
      const group = getGroup(this.bot, groupId)
      const info = group?.info || group
      return {
        groupId: String(groupId),
        groupName: info?.group_name || info?.groupName || info?.name || event?.group_name || '未知群名',
        memberCount: firstMemberCount(info?.member_count, info?.memberCount, event?.member_count, event?.memberCount)
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 读取邀请群缓存失败: ${err.message}`)
    }

    return {
      groupId: String(groupId),
      groupName: event?.group_name || '未知群名',
      memberCount: firstMemberCount(event?.member_count, event?.memberCount)
    }
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
    const message = this.buildReviewMessage(request)
    const msgIds = []
    const manageGroupIds = []

    for (const groupId of this.config.notifyGroups) {
      try {
        const res = await sendGroupMessage(this.bot, Number(groupId) || groupId, message)
        const messageId = res?.message_id || res?.data?.message_id || res?.response?.message_id
        if (messageId) {
          msgIds.push(String(messageId))
        }
        if (res !== false) {
          manageGroupIds.push(String(groupId))
        }
      } catch (err) {
        logger.error(`[自动退群] 发送群邀请审核通知失败，群 ${groupId}: ${err.message}`)
      }
    }

    await this.notifyUsers(message, [request.userId])

    let masterNotified = false
    if (request.precheckStatus === 'failed' && this.config.notifyMasterOnPrecheckReject) {
      masterNotified = await this.notifyMaster(this.buildPrecheckMessage(request))
    }

    return {
      ...request,
      msgIds,
      manageGroupIds,
      masterNotified
    }
  }

  async notifyUsers(message, exclude = []) {
    const excludeSet = new Set(exclude.map(item => String(item)))
    for (const user of this.config.notifyUsers) {
      if (!user.userId || excludeSet.has(String(user.userId))) {
        continue
      }
      await sendPrivateMessage(this.bot, Number(user.userId) || user.userId, message)
    }
  }

  async notifyInviter(request, message) {
    if (!request.userId) {
      return false
    }
    return sendPrivateMessage(this.bot, Number(request.userId) || request.userId, message)
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
    return pending.filter(item => now - Number(item.requestTime || 0) <= this.expireMs)
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
    Config.saveConfig(rootConfig)
    this.reload()
  }

  cleanExpiredPendingRequests() {
    const currentPending = this.getPendingRequests()
    const pending = this.filterPending(currentPending)
    const needsBotMigration = currentPending.some(item => !item.botId && this.botId)
    if (pending.length !== currentPending.length || needsBotMigration) {
      this.savePendingRequests(pending)
    }
    return pending
  }

  addPendingRequest(request) {
    let pending = this.cleanExpiredPendingRequests()
      .filter(item => item.flag !== request.flag)

    while (pending.length >= this.config.maxPendingRequests) {
      pending.shift()
    }

    pending.push({
      ...request,
      botId: request.botId || this.botId,
      status: request.status || (request.precheckStatus === 'failed' ? 'precheck_failed' : 'pending')
    })
    this.savePendingRequests(pending)
  }

  findPendingRequests({ msgId = '', groupId = '', requestId = '' } = {}) {
    const pending = this.cleanExpiredPendingRequests()
    const msg = String(msgId || '')
    const group = String(groupId || '')
    const reqId = String(requestId || '').trim()

    const matched = pending.filter(item => {
      if (reqId && item.requestId === reqId) return true
      if (msg && (item.msgIds || []).map(String).includes(msg)) return true
      if (group && String(item.groupId) === group) return true
      return false
    })

    return matched.sort((a, b) => Number(b.requestTime) - Number(a.requestTime))
  }

  findPendingRequest(criteria = {}) {
    return this.findPendingRequests(criteria)[0] || null
  }

  removePendingRequest(requestId) {
    const pending = this.cleanExpiredPendingRequests()
      .filter(item => item.requestId !== requestId)
    this.savePendingRequests(pending)
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
      Config.saveConfig(rootConfig)
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
      this.markApprovedGroup(request.groupId)
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
