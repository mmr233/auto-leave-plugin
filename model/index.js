import { Config } from '../components/config.js'
import { getGroupName, sendGroupMessage, isBotAdmin, getUserInfo, isUserAdmin, kickUser, muteUser } from '../utils/groupInfo.js'
import { checkBannedWords } from './bannedWordCheck.js'
import { executeLeaveGroup } from './groupCheck.js'
import { clearRetryCount, clearMuteCount } from './muteCheck.js'
import { addToBlacklistAuto, addToWhitelist } from './listManager.js'
import { checkAndLeaveGroupWithRetry } from './groupCheck.js'
import { addUserToBlacklist } from '../utils/yunzaiConfig.js'
import { sleep } from '../utils/common.js'

// 处理标记，防止重复处理
const processedGroups = new Set()

// 违禁词触发记录
const bannedWordTriggers = new Map()

/**
 * 处理群成员增加事件
 */
export async function handleGroupIncrease(e) {
  // 生成唯一标识，防止重复处理同一事件
  const eventKey = `${e.group_id}_${e.user_id}_${Date.now()}`
  if (processedGroups.has(eventKey)) {
    return
  }
  processedGroups.add(eventKey)
  // 清理过期的处理记录（5分钟后清理）
  setTimeout(() => {
    processedGroups.delete(eventKey)
  }, 5 * 60 * 1000)

  logger.info(`[自动退群] 群成员增加: 群${e.group_id}, 用户${e.user_id}, 操作者${e.operator_id}`)

  // 检查黑名单用户
  await checkAndKickBlacklistUser(e)

  await processGroupJoin(e)
}

/**
 * 处理机器人进群
 */
async function processGroupJoin(e) {
  try {
    const botId = e.bot?.uin || e.self_id
    if (e.user_id != botId) {
      return false
    }

    const groupId = e.group_id
    logger.info(`[自动退群] 检测到机器人被拉入群: ${groupId}, 机器人ID: ${botId}`)

    // 检查黑名单 - 黑名单优先级最高
    const blacklist = Config.getBlacklist()
    if (blacklist.includes(parseInt(groupId))) {
      logger.warn(`[自动退群] 群 ${groupId} 在黑名单中，立即退群`)
      const config = Config.loadConfig()
      const groupName = await getGroupName(parseInt(groupId), e.bot || Bot)
      await executeLeaveGroup({
        groupId,
        memberCount: 0,
        bot: e.bot || Bot,
        message: config.blacklistMessage,
        groupName,
        reason: '群聊在黑名单中'
      })
      return
    }

    // 检查白名单 - 白名单群聊不检查成员数量
    const whitelist = Config.getWhitelist()
    if (whitelist.includes(parseInt(groupId))) {
      logger.info(`[自动退群] 群 ${groupId} 在白名单中，跳过检查`)
      // 发送白名单进群提示
      const config = Config.loadConfig()
      if (config.whitelistJoinMessage) {
        try {
          const message = config.whitelistJoinMessage.replace('{groupId}', groupId)
          await sendGroupMessage(e.bot || Bot, groupId, message)
          logger.info(`[自动退群] 已发送白名单进群提示到群 ${groupId}`)
        } catch (err) {
          logger.warn(`[自动退群] 发送白名单进群提示失败: ${err.message}`)
        }
      }
      return
    }

    // 清除该群的重试计数（如果存在）
    clearRetryCount(groupId)

    setTimeout(() => {
      checkAndLeaveGroupWithRetry(groupId, e.bot || Bot)
    }, 5000)
  } catch (err) {
    logger.error('[自动退群] 处理群加入事件出错:', err)
  }
}

/**
 * 检查并踢出黑名单用户
 */
async function checkAndKickBlacklistUser(e) {
  try {
    const config = Config.loadConfig()

    if (!config.whitelistManagement.enabled ||
      !config.whitelistManagement.enableUserBlacklist ||
      !config.whitelistManagement.autoKickBlacklistedUsers) {
      return
    }

    const groupId = e.group_id
    const userId = e.user_id
    const botId = e.bot?.uin || e.self_id

    // 不处理机器人自己的进群
    if (userId === botId) {
      return
    }

    const { getUserBlacklist } = await import('../utils/yunzaiConfig.js')
    const blackUsers = getUserBlacklist()

    if (!blackUsers.includes(parseInt(userId))) {
      return
    }

    // 检查是否为白名单群且机器人是管理员
    const whitelist = Config.getWhitelist()
    if (!whitelist.includes(parseInt(groupId))) {
      return
    }

    const isAdmin = await isBotAdmin(e.bot || Bot, groupId)
    if (!isAdmin) {
      logger.info(`[自动退群] 群 ${groupId} 中机器人不是管理员，无法踢出黑名单用户`)
      return
    }

    const userInfo = await getUserInfo(groupId, userId, e.bot || Bot)
    const displayName = userInfo.card ? `${userInfo.card}(${userInfo.nickname})` : userInfo.nickname

    logger.warn(`[自动退群] 检测到黑名单用户 ${displayName}[${userId}] 在群 ${groupId} 中，准备踢出`)

    // 发送踢出提示
    const kickMessage = config.managementMessages.blacklistUserKick
    try {
      await sendGroupMessage(e.bot || Bot, groupId, kickMessage)
    } catch (err) {
      logger.warn(`[自动退群] 发送黑名单用户踢出提示失败: ${err.message}`)
    }

    // 踢出用户
    setTimeout(async () => {
      const kicked = await kickUser(e.bot || Bot, groupId, userId)
      if (kicked) {
        logger.warn(`[自动退群] 已踢出黑名单用户 ${displayName}[${userId}]`)
      }
    }, 2000)

  } catch (err) {
    logger.error('[自动退群] 检查黑名单用户时出错:', err)
  }
}

/**
 * 初始化事件监听
 */
export function initEventListener() {
  if (Bot && Bot.on) {
    // 监听群成员增加事件（机器人进群和用户进群）
    Bot.on('notice.group.increase', (e) => {
      handleGroupIncrease(e)
    })
    // 监听群禁言事件
    Bot.on('notice.group.ban', (e) => {
      import('./muteCheck.js').then(module => module.handleGroupMute(e))
    })
    logger.info('[自动退群] 插件已加载，开始监听群成员变化和禁言事件')
  }
}