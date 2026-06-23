import { Config } from '../components/config.js'
import { addUserToBlacklist, getUserBlacklist, removeUserFromBlacklist } from './yunzaiConfig.js'

export const TIME_UNIT = {
  毫秒: 0.001,
  秒: 1,
  s: 1,
  S: 1,
  second: 1,
  SECOND: 1,
  分: 60,
  分钟: 60,
  m: 60,
  M: 60,
  min: 60,
  MIN: 60,
  minute: 60,
  MINUTE: 60,
  时: 3600,
  小时: 3600,
  h: 3600,
  H: 3600,
  hour: 3600,
  HOUR: 3600,
  天: 86400,
  日: 86400,
  d: 86400,
  D: 86400,
  day: 86400,
  DAY: 86400,
  周: 604800,
  w: 604800,
  W: 604800,
  week: 604800,
  WEEK: 604800,
  月: 2592000,
  month: 2592000,
  MONTH: 2592000,
  年: 31536000,
  y: 31536000,
  Y: 31536000,
  year: 31536000,
  YEAR: 31536000
}

export const ROLE_MAP = {
  admin: '群管理',
  owner: '群主',
  member: '群员'
}

export function translateChinaNum(input) {
  if (input === undefined || input === null || input === '') {
    return input
  }
  if (/^\d+$/.test(String(input))) {
    return Number(input)
  }

  const map = new Map([
    ['一', 1],
    ['壹', 1],
    ['二', 2],
    ['两', 2],
    ['三', 3],
    ['四', 4],
    ['五', 5],
    ['六', 6],
    ['七', 7],
    ['八', 8],
    ['九', 9]
  ])

  let [yi = '', wan = input] = String(input).split('亿')
  let [qian = '', ge = wan] = String(wan).split('万')
  const parts = [yi, qian, ge]

  const result = parts.map(part => {
    let value = String(part).replaceAll('零', '')
    const reg = new RegExp(`[${Array.from(map.keys()).join('')}]`, 'g')
    value = value.replace(reg, item => String(map.get(item)))

    const num1 = /\d(?=千)/.exec(value)?.[0] || '0'
    const num2 = /\d(?=百)/.exec(value)?.[0] || '0'
    const num3Match = /\d?(?=十)/.exec(value)
    const num3 = num3Match === null ? '0' : (num3Match[0] || '1')
    const num4 = /\d$/.exec(value)?.[0] || '0'
    return `${num1}${num2}${num3}${num4}`
  })

  return Number.parseInt(result.join(''), 10)
}

export function normalizeId(value) {
  const num = Number(value)
  if (Number.isFinite(num) && num > 0) {
    return num
  }
  return String(value)
}

export function getMessageText(e) {
  return String(e?.raw_message || e?.msg || '').trim()
}

export function extractAtIds(e) {
  const message = Array.isArray(e?.message) ? e.message : []
  const ids = message
    .filter(item => item?.type === 'at' && item?.qq && item.qq !== 'all')
    .map(item => normalizeId(item.qq))

  if (ids.length > 0) {
    return ids
  }

  if (e?.at && e.at !== 'all') {
    return [normalizeId(e.at)]
  }

  return []
}

export function getBot(eOrBot) {
  if (!eOrBot) {
    return Bot
  }

  if (eOrBot.sendApi || eOrBot.pickGroup || eOrBot.gl) {
    return eOrBot
  }

  return eOrBot.bot || Bot?.[eOrBot.self_id] || Bot
}

export function getGroup(botOrEvent, groupId) {
  const bot = getBot(botOrEvent)
  const targetGroupId = Number(groupId ?? botOrEvent?.group_id)

  if (!bot || !targetGroupId) {
    return null
  }

  try {
    if (typeof bot.pickGroup === 'function') {
      return bot.pickGroup(targetGroupId, true) || bot.pickGroup(targetGroupId)
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 获取群对象失败: ${err.message}`)
  }

  return bot?.gl?.get?.(targetGroupId) || null
}

export async function callBotApi(botOrEvent, action, params = {}) {
  const bot = getBot(botOrEvent)
  if (!bot) {
    throw new Error('未获取到 Bot 实例')
  }

  if (typeof bot.sendApi === 'function') {
    return bot.sendApi(action, params)
  }

  if (typeof bot[action] === 'function') {
    return bot[action](params)
  }

  throw new Error(`当前协议端不支持 ${action}`)
}

export async function getGroupMemberInfo(botOrEvent, groupId, userId, groupObj = null) {
  const bot = getBot(botOrEvent)
  const group = groupObj || getGroup(bot, groupId)

  try {
    if (group?.pickMember) {
      const member = group.pickMember(Number(userId) || userId, true) || group.pickMember(Number(userId) || userId)
      const info = member?.info || await member?.getInfo?.()
      if (info) {
        return normalizeMemberInfo(info)
      }
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 获取群成员信息失败: ${err.message}`)
  }

  try {
    const res = await callBotApi(bot, 'get_group_member_info', {
      group_id: Number(groupId),
      user_id: Number(userId),
      no_cache: false
    })
    const info = res?.data || res?.response || res
    if (info) {
      return normalizeMemberInfo(info)
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 调用 get_group_member_info 失败: ${err.message}`)
  }

  return null
}

export async function getGroupMemberList(botOrEvent, groupId) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)

  try {
    if (group?.getMemberMap) {
      const map = await group.getMemberMap(true)
      if (map instanceof Map) {
        return Array.from(map.values()).map(normalizeMemberInfo)
      }
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 通过 getMemberMap 获取群成员失败: ${err.message}`)
  }

  try {
    if (group?.members instanceof Map) {
      return Array.from(group.members.values()).map(normalizeMemberInfo)
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 读取群成员缓存失败: ${err.message}`)
  }

  try {
    const res = await callBotApi(bot, 'get_group_member_list', { group_id: Number(groupId) })
    const list = res?.data || res?.response || res?.list || []
    if (Array.isArray(list)) {
      return list.map(normalizeMemberInfo)
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 调用 get_group_member_list 失败: ${err.message}`)
  }

  return []
}

export function normalizeMemberInfo(info = {}) {
  return {
    user_id: normalizeId(info.user_id ?? info.userId ?? info.qq ?? info.uin),
    nickname: info.nickname || info.nick || '',
    card: info.card || info.card_name || '',
    role: info.role || 'member',
    join_time: Number(info.join_time || info.joinTime || 0),
    last_sent_time: Number(info.last_sent_time || info.lastSentTime || 0),
    shut_up_timestamp: Number(info.shut_up_timestamp || info.shutup_time || info.shut_up_time || 0)
  }
}

export function getMemberDisplayName(info, fallback) {
  return info?.card || info?.nickname || String(fallback)
}

export async function getBotRole(botOrEvent, groupId, groupObj = null) {
  const bot = getBot(botOrEvent)
  const group = groupObj || getGroup(bot, groupId)
  if (group?.is_owner) {
    return 'owner'
  }
  if (group?.is_admin) {
    return 'admin'
  }

  const botId = bot?.uin || bot?.self_id
  const info = await getGroupMemberInfo(bot, groupId, botId, group)
  return info?.role || 'member'
}

export async function checkPermission(e, permission = 'all', role = 'all', {
  groupObj = e.group || getGroup(e, e.group_id),
  isReply = true
} = {}) {
  let msg = true

  if (role !== 'all') {
    const botRole = await getBotRole(e, e.group_id || groupObj?.group_id, groupObj)
    if (role === 'owner' && botRole !== 'owner') {
      msg = 'Bot权限不足，需要群主权限'
    } else if (role === 'admin' && botRole !== 'owner' && botRole !== 'admin') {
      msg = 'Bot权限不足，需要管理员权限'
    }
  }

  if (msg === true && !e.isMaster && permission !== 'all') {
    const info = e.member ? normalizeMemberInfo(e.member) : await getGroupMemberInfo(e, e.group_id || groupObj?.group_id, e.user_id, groupObj)
    const userRole = info?.role || 'member'
    if (permission === 'master') {
      msg = '该命令仅限主人可用'
    } else if (permission === 'owner' && userRole !== 'owner') {
      msg = '该命令仅限群主可用'
    } else if (permission === 'admin' && userRole !== 'owner' && userRole !== 'admin') {
      msg = '该命令仅限管理可用'
    }
  }

  if (msg !== true && isReply) {
    await e.reply(msg, true)
  }

  return msg === true
}

export async function muteGroupMember(botOrEvent, groupId, userId, duration) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)
  const targetId = Number(userId) || userId

  try {
    if (group?.muteMember) {
      await group.muteMember(targetId, duration)
      return true
    }
    if (group?.pickMember) {
      const member = group.pickMember(targetId, true) || group.pickMember(targetId)
      if (member?.mute) {
        await member.mute(duration)
        return true
      }
    }
    if (typeof bot.setGroupBan === 'function') {
      await bot.setGroupBan(Number(groupId), targetId, duration)
      return true
    }
    await callBotApi(bot, 'set_group_ban', {
      group_id: Number(groupId),
      user_id: Number(targetId),
      duration: Number(duration)
    })
    return true
  } catch (err) {
    logger.error(`[自动退群] 群禁言失败: ${err.message}`)
    return false
  }
}

export async function kickGroupMember(botOrEvent, groupId, userId, rejectAddRequest = false) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)
  const targetId = Number(userId) || userId

  try {
    if (group?.kickMember) {
      await group.kickMember(targetId, rejectAddRequest)
      return true
    }
    if (group?.pickMember) {
      const member = group.pickMember(targetId, true) || group.pickMember(targetId)
      if (member?.kick) {
        await member.kick(rejectAddRequest)
        return true
      }
    }
    if (typeof bot.setGroupKick === 'function') {
      await bot.setGroupKick(Number(groupId), targetId, rejectAddRequest)
      return true
    }
    await callBotApi(bot, 'set_group_kick', {
      group_id: Number(groupId),
      user_id: Number(targetId),
      reject_add_request: rejectAddRequest
    })
    return true
  } catch (err) {
    logger.error(`[自动退群] 群踢人失败: ${err.message}`)
    return false
  }
}

export async function setGroupWholeBan(botOrEvent, groupId, enable) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)

  try {
    if (group?.muteAll) {
      await group.muteAll(!!enable)
      return true
    }
    if (typeof bot.setGroupWholeBan === 'function') {
      await bot.setGroupWholeBan(Number(groupId), !!enable)
      return true
    }
    await callBotApi(bot, 'set_group_whole_ban', {
      group_id: Number(groupId),
      enable: !!enable
    })
    return true
  } catch (err) {
    logger.error(`[自动退群] 全员禁言失败: ${err.message}`)
    return false
  }
}

export async function setGroupAdminRole(botOrEvent, groupId, userId, enable) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)
  const targetId = Number(userId) || userId

  try {
    if (group?.setAdmin) {
      await group.setAdmin(targetId, !!enable)
      return true
    }
    await callBotApi(bot, 'set_group_admin', {
      group_id: Number(groupId),
      user_id: Number(targetId),
      enable: !!enable
    })
    return true
  } catch (err) {
    logger.error(`[自动退群] 设置群管理失败: ${err.message}`)
    return false
  }
}

export async function setGroupSpecialTitle(botOrEvent, groupId, userId, title) {
  const bot = getBot(botOrEvent)
  const group = getGroup(bot, groupId)
  const targetId = Number(userId) || userId

  try {
    if (group?.setTitle) {
      await group.setTitle(targetId, title)
      return true
    }
    await callBotApi(bot, 'set_group_special_title', {
      group_id: Number(groupId),
      user_id: Number(targetId),
      special_title: title || '',
      duration: -1
    })
    return true
  } catch (err) {
    logger.error(`[自动退群] 设置群头衔失败: ${err.message}`)
    return false
  }
}

export async function setGroupEssenceMessage(botOrEvent, messageId) {
  const bot = getBot(botOrEvent)

  try {
    if (typeof bot.setEssenceMessage === 'function') {
      await bot.setEssenceMessage(messageId)
      return true
    }
    await callBotApi(bot, 'set_essence_msg', { message_id: messageId })
    return true
  } catch (err) {
    logger.error(`[自动退群] 设置精华消息失败: ${err.message}`)
    return false
  }
}

export async function deleteGroupEssenceMessage(botOrEvent, messageId) {
  const bot = getBot(botOrEvent)

  try {
    if (typeof bot.removeEssenceMessage === 'function') {
      await bot.removeEssenceMessage(messageId)
      return true
    }
    await callBotApi(bot, 'delete_essence_msg', { message_id: messageId })
    return true
  } catch (err) {
    logger.error(`[自动退群] 移除精华消息失败: ${err.message}`)
    return false
  }
}

export async function recallGroupMessage(botOrEvent, messageId) {
  const bot = getBot(botOrEvent)

  try {
    if (typeof bot.deleteMsg === 'function') {
      await bot.deleteMsg(messageId)
      return true
    }
    await callBotApi(bot, 'delete_msg', { message_id: messageId })
    return true
  } catch (err) {
    logger.error(`[自动退群] 撤回消息失败: ${err.message}`)
    return false
  }
}

export async function approveGroupRequest(botOrEvent, requestEvent, approve, reason = '') {
  const bot = getBot(botOrEvent)

  if (typeof requestEvent?.approve === 'function') {
    await requestEvent.approve(approve)
    return true
  }

  await callBotApi(bot, 'set_group_add_request', {
    flag: requestEvent.flag,
    sub_type: requestEvent.sub_type || 'add',
    approve: !!approve,
    reason
  })
  return true
}

export async function sendGroupNotice(botOrEvent, groupId, content, image = '') {
  const bot = getBot(botOrEvent)

  try {
    try {
      await callBotApi(bot, '_send_group_notice', {
        group_id: Number(groupId),
        content,
        image
      })
    } catch {
      await callBotApi(bot, 'send_group_notice', {
        group_id: Number(groupId),
        content,
        image
      })
    }
    return true
  } catch (err) {
    logger.error(`[自动退群] 发送群公告失败: ${err.message}`)
    return false
  }
}

export async function getGroupNoticeList(botOrEvent, groupId) {
  const bot = getBot(botOrEvent)

  try {
    let res = null
    try {
      res = await callBotApi(bot, '_get_group_notice', { group_id: Number(groupId) })
    } catch {
      res = await callBotApi(bot, 'get_group_notice', { group_id: Number(groupId) })
    }
    return res?.data || res?.response || res || []
  } catch (err) {
    logger.error(`[自动退群] 获取群公告失败: ${err.message}`)
    return []
  }
}

export async function deleteGroupNotice(botOrEvent, groupId, noticeId) {
  const bot = getBot(botOrEvent)

  try {
    try {
      await callBotApi(bot, '_del_group_notice', {
        group_id: Number(groupId),
        notice_id: noticeId
      })
    } catch {
      await callBotApi(bot, 'del_group_notice', {
        group_id: Number(groupId),
        notice_id: noticeId
      })
    }
    return true
  } catch (err) {
    logger.error(`[自动退群] 删除群公告失败: ${err.message}`)
    return false
  }
}

export async function getQuotedMessage(e, { img = false, file = false } = {}) {
  let source = null

  try {
    if (typeof e.getReply === 'function') {
      source = await e.getReply()
    } else if (e.source && e.group?.getChatHistory) {
      source = (await e.group.getChatHistory(e.source.seq, 1)).pop()
    } else if (e.source && e.friend?.getChatHistory) {
      source = (await e.friend.getChatHistory(e.source.time, 1)).pop()
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 获取引用消息失败: ${err.message}`)
  }

  if (!source) {
    return false
  }

  if (img) {
    return (source.message || []).filter(item => item.type === 'image').map(item => item.url).filter(Boolean)
  }

  if (file) {
    const fileMsg = (source.message || [])[0]
    if (fileMsg?.type !== 'file') {
      return false
    }
    const fid = fileMsg.fid
    return fid && e.isGroup ? e.group?.getFileUrl?.(fid) : e.friend?.getFileUrl?.(fid)
  }

  return source
}

export function formatDuration(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0))
  const day = Math.floor(sec / 86400)
  const hour = Math.floor((sec % 86400) / 3600)
  const minute = Math.floor((sec % 3600) / 60)
  const second = sec % 60
  const parts = []
  if (day) parts.push(`${day}天`)
  if (hour) parts.push(`${hour}小时`)
  if (minute) parts.push(`${minute}分钟`)
  if (second || parts.length === 0) parts.push(`${second}秒`)
  return parts.join('')
}

export function formatDateTime(timestampSeconds) {
  const date = new Date(Number(timestampSeconds) * 1000)
  if (Number.isNaN(date.getTime())) {
    return '未知'
  }

  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function sendByAvailable(e, message) {
  const tasks = [
    async () => e.reply?.(message),
    async () => e.group?.sendMsg?.(message),
    async () => getBot(e).pickGroup?.(Number(e.group_id))?.sendMsg?.(message),
    async () => Bot?.[e.self_id]?.pickGroup?.(Number(e.group_id))?.sendMsg?.(message)
  ]

  for (const task of tasks) {
    try {
      const result = await task()
      return result ?? true
    } catch (err) {
      logger.debug?.(`[自动退群] 发送消息失败: ${err.message}`)
    }
  }

  throw new Error('未获取到可用的发送消息函数')
}

export async function sendForwardMsg(e, messages, {
  title = '消息列表',
  fallbackJoin = '\n----------------\n'
} = {}) {
  const bot = getBot(e)
  const userId = e?.user_id || bot?.uin || 10000
  const nickname = e?.sender?.card || e?.sender?.nickname || e?.nickname || '自动退群'

  try {
    if (typeof bot.makeForwardMsg === 'function') {
      const nodes = messages.map(message => ({
        message,
        nickname,
        user_id: userId
      }))
      const forward = await bot.makeForwardMsg(nodes, true)
      try {
        const direct = await e.reply?.(forward)
        return direct ?? true
      } catch {}
      return sendByAvailable(e, forward)
    }
  } catch (err) {
    logger.debug?.(`[自动退群] 构造转发消息失败: ${err.message}`)
  }

  const text = messages
    .map(item => Array.isArray(item) ? item.map(part => typeof part === 'string' ? part : '[图片/消息段]').join('') : String(item))
    .join(fallbackJoin)

  return sendByAvailable(e, `${title}\n${text}`)
}

export function getGroupAdminBlacklist() {
  return [...new Set((getUserBlacklist() || []).map(item => Number(item)).filter(item => !Number.isNaN(item)))]
}

export function addGroupAdminBlacklist(userId, reason = '群管踢黑') {
  return addUserToBlacklist(userId, reason)
}

export function removeGroupAdminBlacklist(userId) {
  return removeUserFromBlacklist(userId)
}
