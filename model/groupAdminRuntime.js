import { Config } from '../components/config.js'
import { GroupAdminService } from './groupAdminConfig.js'
import {
  approveGroupRequest,
  getGroup,
  getGroupMemberInfo,
  getGroupAdminBlacklist,
  kickGroupMember,
  muteGroupMember,
  recallGroupMessage,
  sendByAvailable,
  sleep
} from '../utils/groupAdmin.js'

const verifySessions = new Map()
const operators = ['+', '-']
let runtimeInited = false

function getVerifyKey(groupId, userId) {
  return `${groupId}:${userId}`
}

function getConfig() {
  return Config.loadConfig()
}

function getVerifyConfig() {
  return getConfig().groupAdmin?.groupVerify || {}
}

function isGroupAdminFeatureEnabled(config, key = '') {
  const groupAdmin = config.groupAdmin || {}
  if (groupAdmin.enabled !== true) {
    return false
  }
  return key ? groupAdmin[key] !== false : true
}

function isWhitelistGroup(groupId) {
  return Config.getWhitelist().map(item => String(item)).includes(String(groupId))
}

function isUserBlacklistActive(config) {
  return !!(
    config.whitelistManagement?.enabled &&
    config.whitelistManagement?.enableUserBlacklist &&
    config.whitelistManagement?.autoKickBlacklistedUsers
  )
}

function isUserBlacklisted(userId) {
  return getGroupAdminBlacklist().includes(Number(userId))
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value
  }
  return value === undefined || value === null ? [] : [value]
}

function getMasterIds(config = getConfig()) {
  return new Set([
    ...toArray(config.masterQQ),
    ...toArray(global.Bot?.cfg?.masterQQ),
    ...toArray(global.Bot?.cfg?.master)
  ].map(item => Number(item)).filter(item => !Number.isNaN(item)))
}

function buildSuccessMessage(groupId) {
  const config = getVerifyConfig()
  return config.successMsgs?.[String(groupId)] || config.successMsgs?.[0] || '验证成功，欢迎入群'
}

function clearSession(groupId, userId) {
  const key = getVerifyKey(groupId, userId)
  const session = verifySessions.get(key)
  if (!session) {
    return
  }
  clearTimeout(session.kickTimer)
  clearTimeout(session.remindTimer)
  verifySessions.delete(key)
}

async function sendVerifyMessage(e, userId, msg) {
  return sendByAvailable(e, [segment.at(userId), msg])
}

export async function startVerifyForUser(e, userId, groupId = e.group_id) {
  const rootConfig = getConfig()
  if (!isGroupAdminFeatureEnabled(rootConfig, 'verifyEnabled')) {
    return false
  }
  const config = rootConfig.groupAdmin?.groupVerify || {}
  const group = getGroup(e, groupId)
  if (!group?.is_admin && !group?.is_owner) {
    return false
  }

  userId = Number(userId)
  groupId = Number(groupId)
  const key = getVerifyKey(groupId, userId)
  clearSession(groupId, userId)

  const operator = operators[Math.floor(Math.random() * operators.length)]
  const min = Number(config.range?.min ?? 10)
  const max = Math.max(min, Number(config.range?.max ?? 100))
  const randomNum = () => Math.floor(Math.random() * (max - min + 1)) + min
  let m = randomNum()
  let n = randomNum()
  while (m === n) {
    n = randomNum()
  }
  if (n > m) {
    [m, n] = [n, m]
  }
  const verifyCode = String(operator === '-' ? m - n : m + n)

  const kickTimer = setTimeout(async () => {
    try {
      await sendVerifyMessage(e, userId, '\n验证超时，移出群聊，请重新申请')
      await kickGroupMember(e, groupId, userId, false)
    } finally {
      clearSession(groupId, userId)
    }
  }, Number(config.time || 300) * 1000)

  const shouldRemind = !!config.remindAtLastMinute && Number(config.time || 300) >= 120
  const remindTimer = setTimeout(async () => {
    const session = verifySessions.get(key)
    if (!session || !shouldRemind) {
      return
    }
    await sendVerifyMessage(e, userId, `\n验证仅剩最后一分钟\n请发送「${m} ${operator} ${n}」的运算结果\n否则将会被移出群聊`)
  }, Math.max(0, Number(config.time || 300) * 1000 - 60000))

  const sent = await sendVerifyMessage(e, userId, ` 欢迎！\n请在「${config.time || 300}」秒内发送\n「${m} ${operator} ${n}」的运算结果\n否则将会被移出群聊`)
  if (!sent) {
    clearTimeout(kickTimer)
    clearTimeout(remindTimer)
    return false
  }

  verifySessions.set(key, {
    remainTimes: Number(config.times || 7),
    nums: [m, n],
    operator,
    verifyCode,
    kickTimer,
    remindTimer
  })
  return true
}

export function hasVerifySession(groupId, userId) {
  return verifySessions.has(getVerifyKey(groupId, userId))
}

export async function passVerify(groupId, userId) {
  clearSession(groupId, userId)
  return buildSuccessMessage(groupId)
}

export async function handleVerifyAnswer(e) {
  const rootConfig = getConfig()
  if (!isGroupAdminFeatureEnabled(rootConfig, 'verifyEnabled')) {
    return false
  }
  const config = rootConfig.groupAdmin?.groupVerify || {}
  const key = getVerifyKey(e.group_id, e.user_id)
  const session = verifySessions.get(key)
  if (!session) {
    return false
  }
  const raw = String(e.raw_message || e.msg || '').trim()
  const isAccurate = config.mode === '精确' && raw === session.verifyCode
  const isFuzzy = config.mode === '模糊' && raw.includes(session.verifyCode)
  if (isAccurate || isFuzzy) {
    clearSession(e.group_id, e.user_id)
    await sendByAvailable(e, buildSuccessMessage(e.group_id))
    return true
  }

  session.remainTimes -= 1
  if (session.remainTimes > 0) {
    try {
      if (e.message_id) {
        await recallGroupMessage(e, e.message_id)
      }
    } catch {}
    await sendVerifyMessage(e, e.user_id, `\n验证失败\n你还有「${session.remainTimes}」次机会\n请发送「${session.nums[0]} ${session.operator} ${session.nums[1]}」的运算结果`)
    return true
  }

  clearSession(e.group_id, e.user_id)
  await sendVerifyMessage(e, e.user_id, '\n验证失败，请重新申请')
  await kickGroupMember(e, e.group_id, e.user_id, false)
  return true
}

export async function reverifyUser(e, userId) {
  const info = await getGroupMemberInfo(e, e.group_id, userId)
  if (!info) {
    throw new Error('目标群成员不存在')
  }
  if (info.role === 'owner' || info.role === 'admin') {
    throw new Error('该命令对群主或管理员无效')
  }
  if (getMasterIds().has(Number(userId))) {
    throw new Error('该命令对机器人主人无效')
  }
  if (hasVerifySession(e.group_id, userId)) {
    throw new Error('目标群成员处于验证状态')
  }
  await startVerifyForUser(e, userId, e.group_id)
}

export async function handleGroupIncreaseForAdmin(e) {
  const config = getConfig()
  if (!isGroupAdminFeatureEnabled(config, 'verifyEnabled')) {
    return false
  }
  const verifyConfig = config.groupAdmin?.groupVerify || {}
  const botId = e.bot?.uin || e.self_id

  if (Number(e.user_id) === Number(botId)) {
    return false
  }

  if (!(verifyConfig.openGroup || []).includes(Number(e.group_id))) {
    return false
  }

  if (!e.group?.is_admin && !e.group?.is_owner) {
    return false
  }

  if (getMasterIds(config).has(Number(e.user_id))) {
    return false
  }
  if ((config.groupAdmin?.whiteQQ || []).includes(Number(e.user_id))) {
    return false
  }

  await sleep(Number(verifyConfig.delayTime || 2) * 1000)
  await startVerifyForUser(e, e.user_id, e.group_id)
  return true
}

export async function handleGroupDecreaseForAdmin(e) {
  clearSession(e.group_id, e.user_id)
  return true
}

export async function handleGroupBanForAdmin(e) {
  const config = getConfig()
  if (!isGroupAdminFeatureEnabled(config, 'commandsEnabled')) {
    return false
  }
  const isWhiteUser = (config.groupAdmin?.whiteQQ || []).includes(Number(e.user_id))
  const botId = e.bot?.uin || global.Bot?.uin || global.Bot?.self_id
  const isMasterOperator = getMasterIds(config).has(Number(e.operator_id)) || Number(e.operator_id) === Number(botId)
  if (isWhiteUser && !isMasterOperator && config.groupAdmin?.noBan && (e.group?.is_admin || e.group?.is_owner) && Number(e.duration) !== 0) {
    await muteGroupMember(e, e.group_id, e.user_id, 0)
    await sendByAvailable(e, '已解除白名单用户的禁言')
    return true
  }
  return false
}

export async function handleGroupRequestForAdmin(e) {
  const config = getConfig()
  if (!isGroupAdminFeatureEnabled(config)) {
    return false
  }
  if (e.request_type !== 'group' || e.sub_type !== 'add') {
    return false
  }

  const shouldRejectBlacklistedUser = isGroupAdminFeatureEnabled(config, 'blacklistRequestRejectEnabled') &&
    isUserBlacklistActive(config) &&
    isWhitelistGroup(e.group_id) &&
    isUserBlacklisted(e.user_id)
  if (shouldRejectBlacklistedUser) {
    await approveGroupRequest(e, e, false, '黑名单用户禁止入群')
    return true
  }

  if (!isGroupAdminFeatureEnabled(config, 'noticeEnabled')) {
    return false
  }

  const notifyGroups = config.groupAdmin?.groupAddNotice?.openGroup || []
  if (!notifyGroups.includes(Number(e.group_id))) {
    return false
  }

  const msg = [
    `${config.groupAdmin?.groupAddNotice?.msg || '收到加群申请'}\n`,
    segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${e.user_id}`),
    `QQ号：${e.user_id}\n`,
    `昵称：${e.nickname || '未知'}\n`,
    `${e.comment || ''}`
  ]
  if (e.inviter_id !== undefined) {
    msg.push(`\n邀请人：${e.inviter_id}`)
  }
  await e.bot?.pickGroup?.(Number(e.group_id))?.sendMsg?.(msg)
  return true
}

export function initGroupAdminRuntime() {
  if (runtimeInited) {
    return true
  }
  runtimeInited = true
  const config = getConfig()
  if (isGroupAdminFeatureEnabled(config, 'scheduledMuteEnabled')) {
    GroupAdminService.loadMuteTasks()
  }

  if (!(Bot && Bot.on)) {
    return false
  }

  Bot.on('notice.group.increase', e => {
    handleGroupIncreaseForAdmin(e)
  })
  Bot.on('notice.group.decrease', e => {
    handleGroupDecreaseForAdmin(e)
  })
  Bot.on('notice.group.ban', e => {
    handleGroupBanForAdmin(e)
  })
  Bot.on('request', e => {
    handleGroupRequestForAdmin(e)
  })
  Bot.on('message.group', e => {
    handleVerifyAnswer(e)
  })

  return true
}
