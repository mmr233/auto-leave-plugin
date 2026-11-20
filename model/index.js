import { Config } from '../components/config.js'
import { getGroupName, sendGroupMessage, isBotAdmin, getUserInfo, isUserAdmin, kickUser, muteUser } from '../utils/groupInfo.js'
import { checkBannedWords } from './bannedWordCheck.js'
import { executeLeaveGroup } from './groupCheck.js'
import { clearRetryCount, clearMuteCount } from './muteCheck.js'
import { addToBlacklistAuto, addToWhitelist } from './listManager.js'
import { checkAndLeaveGroupWithRetry } from './groupCheck.js'
import { addUserToBlacklist } from '../utils/yunzaiConfig.js'
import { sleep } from '../utils/common.js'
import { initGroupAdminRuntime } from './groupAdminRuntime.js'
import { InviteManagementService, normalizeIdList, reconcilePendingInviteRequests, REVIEW_MODE } from './inviteManagement.js'
import { beginStayReview, cancelStayReviewForGroup, reconcileStayReviews } from './stayReview.js'
import { rememberInviteCard } from './inviteCard.js'

// 处理标记，防止重复处理
const processedGroups = new Map()

// 违禁词触发记录
const bannedWordTriggers = new Map()
let eventListenerReady = false

/**
 * 处理群成员增加事件
 */
export async function handleGroupIncrease(e) {
  const botId = String(e.bot?.uin || e.bot?.self_id || e.self_id || '')
  const eventId = e.event_id || e.time || ''
  const eventKey = `${botId}:${e.group_id}:${e.user_id}:${eventId || 'untimed'}`
  if (processedGroups.has(eventKey)) {
    return
  }
  const token = Symbol()
  processedGroups.set(eventKey, token)
  const cleanup = setTimeout(() => {
    if (processedGroups.get(eventKey) === token) processedGroups.delete(eventKey)
  }, eventId ? 5 * 60 * 1000 : 5000)
  cleanup.unref?.()

  logger.info(`[自动退群] 群成员增加: 群${e.group_id}, 用户${e.user_id}, 操作者${e.operator_id}`)

  // 检查黑名单用户
  await checkAndKickBlacklistUser(e)

  await processGroupJoin(e)
}

/**
 * 处理机器人进群
 */
export async function processGroupJoin(e) {
  try {
    const botId = e.bot?.uin || e.self_id
    if (e.user_id != botId) {
      return false
    }

    const groupId = e.group_id
    logger.info(`[自动退群] 检测到机器人被拉入群: ${groupId}, 机器人ID: ${botId}`)
    const config = Config.loadConfig()
    const inviteService = new InviteManagementService(e)

    // 检查黑名单 - 黑名单优先级最高
    const blacklist = [
      ...Config.getBlacklist().map(item => String(item)),
      ...normalizeIdList(config.inviteManagement?.blackGroups)
    ]
    if (blacklist.includes(String(groupId))) {
      logger.warn(`[自动退群] 群 ${groupId} 在黑名单中，立即退群`)
      const groupName = await getGroupName(parseInt(groupId), e.bot || Bot)
      const left = await executeLeaveGroup({
        groupId,
        memberCount: 0,
        bot: e.bot || Bot,
        message: config.blacklistMessage,
        groupName,
        reason: '群聊在黑名单中'
      })
      const pending = inviteService.getPendingJoin(groupId)
      if (left && pending) inviteService.removePendingJoin(pending)
      return
    }

    // 检查白名单 - 白名单群聊不检查成员数量
    const whitelist = [
      ...Config.getWhitelist().map(item => String(item)),
      ...normalizeIdList(config.inviteManagement?.whiteGroups)
    ]
    if (whitelist.includes(String(groupId))) {
      const pending = inviteService.getPendingJoin(groupId)
      if (pending) inviteService.removePendingJoin(pending)
      logger.info(`[自动退群] 群 ${groupId} 在白名单中，跳过检查`)
      // 发送白名单进群提示
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

    const cooldown = inviteService.getStayCooldown(groupId)
    if (cooldown) {
      logger.warn(`[自动退群] 群 ${groupId} 仍处于退群冷却期，将自动退出`)
      const started = await beginStayReview(groupId, null, e.bot || Bot, { reviewType: 'cooldown' })
      const pending = inviteService.getPendingJoin(groupId)
      if (started && pending) new InviteManagementService(e).removePendingJoin(pending)
      if (!started) {
        logger.error(`[自动退群] 无法保存群 ${groupId} 的冷却退群状态，尝试立即退群`)
        await executeLeaveGroup({ groupId, bot: e.bot || Bot, reason: '留群审核退群冷却中', skipGroupMessage: true })
      }
      return
    }

    const approvedByInvite = inviteService.isApprovedGroup(groupId)
      ? inviteService.consumeApprovedGroup(groupId)
      : false

    // 人工批准或主人强制放行的群只跳过本次进群后人数退群检查，消费一次即失效。
    if (approvedByInvite) {
      const pending = inviteService.getPendingJoin(groupId)
      if (pending) inviteService.removePendingJoin(pending)
      logger.info(`[自动退群] 群 ${groupId} 已通过邀请审核，跳过本次人数检查`)
      return
    }

    const pendingJoin = inviteService.getPendingJoin(groupId)
    if (pendingJoin || (inviteService.config.enabled && inviteService.config.reviewMode === REVIEW_MODE.POST_JOIN)) {
      const started = await beginStayReview(groupId, null, e.bot || Bot, {
        reviewType: 'post_join',
        userId: pendingJoin?.userId || e.operator_id
      })
      if (started && pendingJoin) new InviteManagementService(e).removePendingJoin(pendingJoin)
      if (!started) {
        logger.error(`[自动退群] 无法保存群 ${groupId} 的留群审核状态，尝试立即退群`)
        await executeLeaveGroup({ groupId, bot: e.bot || Bot, reason: '留群审核状态保存失败', skipGroupMessage: true })
      }
      return
    }

    // 清除该群的重试计数（如果存在）
    clearRetryCount(groupId)

    setTimeout(() => {
      checkAndLeaveGroupWithRetry(groupId, e.bot || Bot, 0, beginStayReview)
        .catch(err => logger.error(`[自动退群] 检查群 ${groupId} 人数失败: ${err.message}`))
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
  if (eventListenerReady) {
    return true
  }

  const bot = globalThis.Bot
  if (!bot?.on) {
    return false
  }

  if (!initGroupAdminRuntime()) {
    return false
  }

  bot.on('message.private', rememberInviteCard)

  // 监听群成员增加事件（机器人进群和用户进群）
  bot.on('notice.group.increase', (e) => {
    handleGroupIncrease(e)
  })
  bot.on('notice.group.decrease', (e) => {
    const botId = String(e.bot?.uin || e.bot?.self_id || e.self_id || '')
    const prefix = `${botId}:${e.group_id}:${e.user_id}:`
    for (const key of processedGroups.keys()) {
      if (key.startsWith(prefix)) processedGroups.delete(key)
    }
    cancelStayReviewForGroup(e)
  })
  // 监听群禁言事件
  bot.on('notice.group.ban', (e) => {
    import('./muteCheck.js').then(module => module.handleGroupMute(e))
  })

  eventListenerReady = true
  reconcileStayReviews()
  reconcilePendingInviteRequests()
  const recoveryTimer = setInterval(() => {
    reconcileStayReviews()
    reconcilePendingInviteRequests()
  }, 30 * 1000)
  recoveryTimer.unref?.()

  return true
}
