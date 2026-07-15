import { Config } from '../components/config.js'
import { getGroupName } from '../utils/groupInfo.js'
import { executeLeaveGroup } from './groupCheck.js'
import { addToBlacklistAuto } from './listManager.js'

/**
 * 禁言次数记录
 * {groupId: retryCount}
 */
const retryCountMap = new Map()

/**
 * 禁言次数记录
 * {groupId: muteCount}
 */
const muteCountMap = new Map()

function formatTemplate(template, variables) {
  return Object.entries(variables).reduce((text, [key, value]) => {
    return text.split(`{${key}}`).join(String(value))
  }, String(template || ''))
}

function buildMuteLeaveReason(config, { muteCount, operatorId, duration }) {
  const operator = operatorId || '未知'
  const muteDuration = duration || 0
  const blacklistStatus = config.autoBlacklistOnMute ? '已自动加入群黑名单' : '未自动加入群黑名单'
  const fallbackReason = `机器人被禁言${muteCount}次，已达到退群阈值${config.muteCountLimit}次；本次操作者：${operator}；禁言时长：${muteDuration}秒；${blacklistStatus}`
  const template = String(config.muteLeaveMessage || '').trim()

  if (!template) {
    return fallbackReason
  }

  const reason = formatTemplate(template, {
    muteCount,
    muteCountLimit: config.muteCountLimit,
    operatorId: operator,
    duration: muteDuration,
    blacklistStatus
  })

  const extraDetails = []
  if (!template.includes('{operatorId}')) {
    extraDetails.push(`操作者：${operator}`)
  }
  if (!template.includes('{duration}')) {
    extraDetails.push(`禁言时长：${muteDuration}秒`)
  }
  if (!template.includes('{blacklistStatus}')) {
    extraDetails.push(`黑名单处理：${blacklistStatus}`)
  }

  return extraDetails.length ? `${reason}\n${extraDetails.join('\n')}` : reason
}

/**
 * 加载禁言次数记录
 */
export function loadMuteCount() {
  try {
    const muteData = Config.getMuteCount()
    const now = Date.now()
    const config = Config.loadConfig()

    // 清理过期的禁言记录
    for (const [groupId, muteInfo] of Object.entries(muteData)) {
      if (muteInfo.lastMuteTime && (now - muteInfo.lastMuteTime) < config.muteCountResetTime) {
        muteCountMap.set(groupId, muteInfo.count || 0)
      }
    }

    logger.info(`[自动退群] 已加载禁言次数记录，共 ${muteCountMap.size} 个群`)
  } catch (err) {
    logger.error('[自动退群] 加载禁言次数记录失败:', err)
  }
}

/**
 * 保存禁言次数记录
 */
export function saveMuteCount() {
  try {
    const muteData = {}
    const now = Date.now()

    for (const [groupId, count] of muteCountMap.entries()) {
      muteData[groupId] = {
        count: count,
        lastMuteTime: now
      }
    }

    Config.saveMuteCount(muteData)
    logger.debug(`[自动退群] 已保存禁言次数记录`)
  } catch (err) {
    logger.error('[自动退群] 保存禁言次数记录失败:', err)
  }
}

/**
 * 处理禁言事件
 */
export async function handleGroupMute(e) {
  try {
    const groupId = e.group_id
    const botId = e.bot?.uin || e.self_id
    const operatorId = e.operator_id
    const userId = e.user_id
    const duration = e.duration

    // 只处理机器人被禁言的情况
    if (userId !== botId) {
      return
    }

    // 如果禁言时长为0，表示解除禁言，不处理
    if (duration === 0) {
      logger.info(`[自动退群] 机器人在群 ${groupId} 被解除禁言，操作者: ${operatorId}`)
      return
    }

    logger.warn(`[自动退群] 机器人在群 ${groupId} 被禁言 ${duration} 秒，操作者: ${operatorId}`)

    // 检查白名单，白名单群不受禁言限制影响
    const whitelist = Config.getWhitelist()
    if (whitelist.includes(parseInt(groupId))) {
      logger.info(`[自动退群] 群 ${groupId} 在白名单中，忽略禁言检测`)
      return
    }

    // 增加禁言次数
    const currentCount = muteCountMap.get(groupId) || 0
    const newCount = currentCount + 1
    muteCountMap.set(groupId, newCount)

    // 保存禁言次数记录
    saveMuteCount()

    const config = Config.loadConfig()
    logger.warn(`[自动退群] 群 ${groupId} 禁言次数: ${newCount}/${config.muteCountLimit}`)

    // 检查是否达到禁言次数限制
    if (newCount >= config.muteCountLimit) {
      const groupName = await getGroupName(parseInt(groupId), e.bot || Bot)
      const detailedReason = buildMuteLeaveReason(config, {
        muteCount: newCount,
        operatorId,
        duration
      })

      // 检查是否需要自动加入黑名单
      if (config.autoBlacklistOnMute) {
        await addToBlacklistAuto(groupId, detailedReason)
      }

      logger.warn(`[自动退群] 群 ${groupId} 禁言次数已达到限制，开始退群`)

      // 延迟一段时间后退群，以防机器人立即被解除禁言
      setTimeout(async () => {
        await executeLeaveGroup({
          groupId,
          memberCount: 0,
          bot: e.bot || Bot,
          message: '',
          groupName,
          reason: detailedReason,
          skipGroupMessage: true
        })
        // 清除该群的禁言记录
        muteCountMap.delete(groupId)
        saveMuteCount()
      }, 5000)
    }
  } catch (err) {
    logger.error('[自动退群] 处理禁言事件时出错:', err)
  }
}

/**
 * 清除重试记录
 */
export function clearRetryCount(groupId) {
  retryCountMap.delete(groupId)
}

/**
 * 清除禁言记录
 */
export function clearMuteCount(groupId) {
  muteCountMap.delete(groupId)
  saveMuteCount()
}
