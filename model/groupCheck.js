import { Config } from '../../components/config.js'
import { getGroupName, leaveGroup, sendGroupMessage, sendPrivateMessage } from '../../utils/groupInfo.js'
import { getMasterQQ, sleep } from '../../utils/common.js'

/**
 * 执行退群操作
 * @param {object} options - 退群选项
 */
export async function executeLeaveGroup(options) {
  const { groupId, memberCount, bot, message, groupName, reason } = options
  const config = Config.loadConfig()

  try {
    const actualReason = reason || (memberCount === 0 ? '未知原因' : `群成员数量不足(${memberCount}人)`)
    logger.warn(`[自动退群] 群 ${groupId} 开始执行退群操作，原因: ${actualReason}`)

    // 获取群名称（如果还没有）
    const actualGroupName = groupName || await getGroupName(parseInt(groupId), bot)

    // 发送退群提示消息
    try {
      await sendGroupMessage(bot, groupId, message)
      logger.info(`[自动退群] 已向群 ${groupId} 发送退群提示消息`)
    } catch (msgErr) {
      logger.warn(`[自动退群] 发送退群消息失败: ${msgErr.message}`)
    }

    // 延迟退群
    await sleep(2000)

    // 执行退群
    const success = await leaveGroup(bot, groupId)
    if (success) {
      logger.info(`[自动退群] 成功退出群聊: ${groupId}`)

      // 发送退群通知给主人
      await sendNotificationToMaster(groupId, actualGroupName, actualReason, bot)
    } else {
      logger.error(`[自动退群] 退群失败: ${groupId}`)
    }

    return success
  } catch (err) {
    logger.error(`[自动退群] 执行退群操作时出错:`, err)
    return false
  }
}

/**
 * 向主人发送通知
 */
async function sendNotificationToMaster(groupId, groupName, reason, bot) {
  const config = Config.loadConfig()

  if (!config.notification || !config.notification.enabled) {
    logger.info('[自动退群] 通知功能已关闭')
    return
  }

  const botId = bot?.uin || bot?.self_id
  const masterQQ = getMasterQQ(botId)

  if (!masterQQ) {
    logger.warn('[自动退群] 未找到主人QQ号，无法发送通知')
    return
  }

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

  const message = config.notification.message
    .replace('{groupId}', groupId)
    .replace('{groupName}', groupName || '未知群名')
    .replace('{reason}', reason)
    .replace('{time}', timeStr)

  await sendPrivateMessage(bot, parseInt(masterQQ), message)
  logger.info(`[自动退群] 已向主人 ${masterQQ} 发送退群通知`)
}

/**
 * 检查并退群（带重试）
 */
export async function checkAndLeaveGroupWithRetry(groupId, bot, retryCount = 0) {
  const config = Config.loadConfig()
  const maxRetryCount = config.maxRetryCount || 3
  const retryDelay = config.retryDelay || 10000

  logger.info(`[自动退群] 开始检查群 ${groupId} 成员数量 (尝试次数: ${retryCount + 1}/${maxRetryCount})`)

  let memberCount = 0
  let groupInfo = null

  // 只使用bot.gl方法获取群成员数量（从缓存读取，无网络请求）
  if (bot.gl && bot.gl.has(groupId)) {
    groupInfo = bot.gl.get(groupId)
    if (groupInfo && groupInfo.member_count) {
      memberCount = groupInfo.member_count
      logger.info(`[自动退群] 通过bot.gl获取群 ${groupId} 成员数量: ${memberCount}`)
    }
  }

  if (!memberCount) {
    logger.warn(`[自动退群] 无法获取群 ${groupId} 的成员数量 (尝试次数: ${retryCount + 1}/${maxRetryCount})`)

    // 如果还有重试次数，则继续重试
    if (retryCount < maxRetryCount - 1) {
      logger.info(`[自动退群] 将在 ${retryDelay / 1000} 秒后重试获取群 ${groupId} 成员数量`)
      await sleep(retryDelay)
      return checkAndLeaveGroupWithRetry(groupId, bot, retryCount + 1)
    } else {
      // 重试3次失败，执行错误退群
      logger.error(`[自动退群] 群 ${groupId} 重试 ${maxRetryCount} 次后仍无法获取成员数量，执行错误退群`)
      const groupName = await getGroupName(parseInt(groupId), bot)
      await executeLeaveGroup({
        groupId,
        memberCount: 0,
        bot,
        message: config.errorLeaveMessage,
        groupName,
        reason: '获取群信息失败'
      })
      return false
    }
  }

  logger.info(`[自动退群] 群 ${groupId} 当前成员数量: ${memberCount}`)

  if (memberCount < config.minMemberCount) {
    const message = config.leaveMessage
      .replace('{memberCount}', memberCount)
      .replace('{minMemberCount}', config.minMemberCount)
    const groupName = await getGroupName(parseInt(groupId), bot)
    await executeLeaveGroup({
      groupId,
      memberCount,
      bot,
      message,
      groupName,
      reason: '群成员数量不足'
    })
    return true
  } else {
    logger.info(`[自动退群] 群 ${groupId} 成员数量 ${memberCount} 符合要求，继续留在群内`)
    return false
  }
}