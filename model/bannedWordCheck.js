import { Config } from '../components/config.js'
import { getGroupName, sendGroupMessage, getUserInfo, isBotAdmin, isUserAdmin, muteUser, kickUser } from '../utils/groupInfo.js'
import { executeLeaveGroup } from './groupCheck.js'
import { addToBlacklistAuto } from './listManager.js'
import { addUserToBlacklist } from '../utils/yunzaiConfig.js'

/**
 * 违禁词触发记录
 * {groupId: {userId: {count: number, words: [], userInfo: {}, lastTriggerTime: number, muteCount: number}}}
 */
const bannedWordTriggers = new Map()

/**
 * 检查消息是否包含违禁词
 * @param {string} message - 消息内容
 * @returns {string[]|null} 找到的违禁词列表
 */
export function checkBannedWords(message) {
  const bannedWords = Config.getBannedWords()
  if (bannedWords.length === 0) return null

  const foundWords = []
  for (const word of bannedWords) {
    if (message.includes(word)) {
      foundWords.push(word)
    }
  }
  return foundWords.length > 0 ? foundWords : null
}

/**
 * 处理违禁词触发（非白名单群）
 */
export async function handleBannedWordTrigger(e) {
  try {
    const groupId = e.group_id
    const userId = e.user_id
    const config = Config.loadConfig()

    // 检查白名单，白名单群不受违禁词影响
    const whitelist = Config.getWhitelist()
    if (whitelist.includes(parseInt(groupId))) {
      logger.info(`[自动退群] 群 ${groupId} 在白名单中，忽略违禁词检测`)
      return
    }

    // 获取用户详细信息
    const userInfo = await getUserInfo(groupId, userId, e.bot || Bot)
    const userName = userInfo.nickname
    const userCard = userInfo.card

    // 初始化群记录
    if (!bannedWordTriggers.has(groupId)) {
      bannedWordTriggers.set(groupId, new Map())
    }

    const groupTriggers = bannedWordTriggers.get(groupId)
    const currentCount = groupTriggers.get(userId) || 0
    const newCount = currentCount + 1

    // 记录违禁词信息
    if (!groupTriggers.has(`${userId}_words`)) {
      groupTriggers.set(`${userId}_words`, [])
    }
    const userBannedWords = groupTriggers.get(`${userId}_words`)

    // 检查当前消息中的违禁词
    const currentBannedWords = checkBannedWords(e.msg)
    if (currentBannedWords) {
      for (const word of currentBannedWords) {
        if (!userBannedWords.includes(word)) {
          userBannedWords.push(word)
        }
      }
    }

    groupTriggers.set(userId, newCount)
    groupTriggers.set(`${userId}_info`, { nickname: userName, card: userCard })

    const displayName = userCard ? `${userCard}(${userName})` : userName
    logger.warn(`[自动退群] 用户 ${displayName}[${userId}] 在群 ${groupId} 发送违禁词"${currentBannedWords?.join('、')}"，当前次数: ${newCount}/${config.bannedWordTriggerLimit}`)

    if (newCount >= config.bannedWordTriggerLimit) {
      // 达到触发次数，执行退群
      let message = config.bannedWordLeaveMessage
      const groupName = await getGroupName(parseInt(groupId), e.bot || Bot)

      // 构建详细的退群原因
      const detailedReason = `违禁词触发 - ${displayName}[${userId}] 发送违禁词: 「${userBannedWords.join('」、「')}」(共${newCount}次)`

      // 检查是否需要自动加入黑名单
      if (config.autoBlacklistOnBannedWord) {
        await addToBlacklistAuto(groupId, detailedReason)
        message = config.bannedWordLeaveMessage
      } else {
        message = "检测到违禁词触发次数超过限制，胡桃将自动退群。"
      }

      logger.warn(`[自动退群] 用户 ${displayName}[${userId}] 违禁词触发次数已达到限制，开始退群`)
      await executeLeaveGroup({
        groupId,
        memberCount: 0,
        bot: e.bot || Bot,
        message,
        groupName,
        reason: detailedReason
      })

      // 清除该群的触发记录
      bannedWordTriggers.delete(groupId)
    }
  } catch (err) {
    logger.error('[自动退群] 处理违禁词触发时出错:', err)
  }
}

/**
 * 处理白名单群聊中的违禁词
 */
export async function handleWhitelistBannedWord(e) {
  try {
    const groupId = e.group_id
    const userId = e.user_id
    const config = Config.loadConfig()

    if (!config.whitelistManagement.enabled) {
      return
    }

    // 检查机器人是否为管理员
    const isBotAdmin = await isBotAdmin(e.bot || Bot, groupId)
    if (!isBotAdmin) {
      logger.info(`[自动退群] 群 ${groupId} 中机器人不是管理员，无法执行管理操作`)
      return
    }

    // 获取用户信息
    const userInfo = await getUserInfo(groupId, userId, e.bot || Bot)

    // 检查发送者是否为管理员或群主
    if (isUserAdmin(userInfo)) {
      logger.info(`[自动退群] 群 ${groupId} 中管理员/群主 ${userInfo.nickname}[${userId}] 发送违禁词，跳过处理`)
      try {
        await sendGroupMessage(e.bot || Bot, groupId, config.managementMessages.adminReply)
      } catch (err) {
        logger.warn(`[自动退群] 发送特殊回复失败: ${err.message}`)
      }
      return
    }

    // 初始化群记录
    if (!bannedWordTriggers.has(groupId)) {
      bannedWordTriggers.set(groupId, new Map())
    }

    const groupTriggers = bannedWordTriggers.get(groupId)

    // 初始化用户记录
    if (!groupTriggers.has(userId)) {
      groupTriggers.set(userId, {
        count: 0,
        words: [],
        lastTriggerTime: 0,
        userInfo: userInfo,
        muteCount: 0
      })
    }

    const userRecord = groupTriggers.get(userId)

    // 检查消息中的违禁词
    const foundWords = checkBannedWords(e.msg)
    if (!foundWords || foundWords.length === 0) {
      return
    }

    // 更新用户记录
    userRecord.count += 1
    userRecord.lastTriggerTime = Date.now()

    // 添加新发现的违禁词
    for (const word of foundWords) {
      if (!userRecord.words.includes(word)) {
        userRecord.words.push(word)
      }
    }

    const displayName = userInfo.card ? `${userInfo.card}(${userInfo.nickname})` : userInfo.nickname
    logger.warn(`[自动退群] 白名单群 ${groupId} 中用户 ${displayName}[${userId}] 发送违禁词"${foundWords.join('、')}"，总次数: ${userRecord.count}`)

    // 检查是否达到禁言触发条件
    if (userRecord.count % config.whitelistManagement.bannedWordMuteTrigger === 0) {
      userRecord.muteCount += 1

      // 检查是否达到踢出条件
      if (userRecord.muteCount > config.whitelistManagement.muteLimitBeforeKick) {
        await kickUserForBannedWord(e, groupId, userId, userRecord, displayName, config)
      } else {
        await muteUserForBannedWord(e, groupId, userId, userRecord, displayName, config)
      }
    }
  } catch (err) {
    logger.error('[自动退群] 处理白名单群聊违禁词时出错:', err)
  }
}

/**
 * 禁言用户（违禁词触发）
 */
async function muteUserForBannedWord(e, groupId, userId, userRecord, displayName, config) {
  const muteDuration = config.whitelistManagement.baseMuteDuration +
    (userRecord.muteCount - 1) * config.whitelistManagement.muteIncrement
  const muteDurationSeconds = muteDuration * 60

  const muteMessage = config.managementMessages.muteWarning
    .replace('{duration}', muteDuration)

  try {
    await sendGroupMessage(
      e.bot || Bot,
      groupId,
      [segment.at(userId), ` ${muteMessage}`]
    )
  } catch (err) {
    logger.warn(`[自动退群] 发送禁言警告失败: ${err.message}`)
  }

  // 执行禁言
  setTimeout(async () => {
    const muted = await muteUser(e.bot || Bot, groupId, userId, muteDurationSeconds)
    if (muted) {
      logger.warn(`[自动退群] 已禁言用户 ${displayName}[${userId}] ${muteDuration}分钟，第${userRecord.muteCount}次禁言`)
    }
  }, 1000)
}

/**
 * 踢出用户（违禁词触发）
 */
async function kickUserForBannedWord(e, groupId, userId, userRecord, displayName, config) {
  const kickMessage = config.managementMessages.kickWarning

  try {
    await sendGroupMessage(
      e.bot || Bot,
      groupId,
      [segment.at(userId), ` ${kickMessage}`]
    )
  } catch (err) {
    logger.warn(`[自动退群] 发送踢出提示失败: ${err.message}`)
  }

  // 添加到用户黑名单
  if (config.whitelistManagement.enableUserBlacklist) {
    await addUserToBlacklist(userId, `白名单群${groupId}违禁词${userRecord.count}次`)
  }

  // 延迟踢出
  setTimeout(async () => {
    const kicked = await kickUser(e.bot || Bot, groupId, userId)
    if (kicked) {
      logger.warn(`[自动退群] 已踢出用户 ${displayName}[${userId}]，原因：违禁词${userRecord.count}次`)
    }
  }, 2000)

  // 清除用户记录
  const groupTriggers = bannedWordTriggers.get(groupId)
  groupTriggers.delete(userId)
}