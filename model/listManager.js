import { Config } from '../components/config.js'

/**
 * 自动加入黑名单
 * @param {number} groupId - 群号
 * @param {string} reason - 原因
 */
export async function addToBlacklistAuto(groupId, reason) {
  try {
    const blacklist = Config.getBlacklist()
    const groupIdNum = parseInt(groupId)

    // 检查是否已在黑名单中
    if (blacklist.includes(groupIdNum)) {
      logger.info(`[自动退群] 群 ${groupId} 已在黑名单中`)
      return true
    }

    // 从白名单中移除（如果存在）
    const whitelist = Config.getWhitelist()
    const whitelistIndex = whitelist.indexOf(groupIdNum)
    if (whitelistIndex !== -1) {
      whitelist.splice(whitelistIndex, 1)
      Config.saveWhitelist(whitelist)
      logger.info(`[自动退群] 群 ${groupId} 已从白名单自动移除`)
    }

    // 添加到黑名单
    blacklist.push(groupIdNum)
    if (Config.saveBlacklist(blacklist)) {
      logger.warn(`[自动退群] 群 ${groupId} 因${reason}已自动加入黑名单`)
      return true
    } else {
      logger.error(`[自动退群] 群 ${groupId} 自动加入黑名单失败`)
      return false
    }
  } catch (err) {
    logger.error(`[自动退群] 自动加入黑名单时出错:`, err)
    return false
  }
}

/**
 * 添加到白名单
 */
export function addToWhitelist(groupId) {
  const whitelist = Config.getWhitelist()
  const groupIdNum = parseInt(groupId)

  if (whitelist.includes(groupIdNum)) {
    return { success: false, message: `群 ${groupId} 已在白名单中` }
  }

  // 从黑名单中移除（如果存在）
  const blacklist = Config.getBlacklist()
  const blacklistIndex = blacklist.indexOf(groupIdNum)
  if (blacklistIndex !== -1) {
    blacklist.splice(blacklistIndex, 1)
    Config.saveBlacklist(blacklist)
    logger.info(`[自动退群] 群 ${groupId} 已从黑名单自动移除`)
  }

  whitelist.push(groupIdNum)
  if (Config.saveWhitelist(whitelist)) {
    return { success: true, message: `成功将群 ${groupId} 添加到白名单${blacklistIndex !== -1 ? '（已自动从黑名单移除）' : ''}` }
  }
  return { success: false, message: '添加白名单失败' }
}

/**
 * 添加到黑名单
 */
export function addToBlacklist(groupId) {
  const blacklist = Config.getBlacklist()
  const groupIdNum = parseInt(groupId)

  if (blacklist.includes(groupIdNum)) {
    return { success: false, message: `群 ${groupId} 已在黑名单中` }
  }

  // 从白名单中移除（如果存在）
  const whitelist = Config.getWhitelist()
  const whitelistIndex = whitelist.indexOf(groupIdNum)
  if (whitelistIndex !== -1) {
    whitelist.splice(whitelistIndex, 1)
    Config.saveWhitelist(whitelist)
    logger.info(`[自动退群] 群 ${groupId} 已从白名单自动移除`)
  }

  blacklist.push(groupIdNum)
  if (Config.saveBlacklist(blacklist)) {
    return { success: true, message: `成功将群 ${groupId} 添加到黑名单${whitelistIndex !== -1 ? '（已自动从白名单移除）' : ''}` }
  }
  return { success: false, message: '添加黑名单失败' }
}

/**
 * 从白名单移除
 */
export function removeFromWhitelist(groupId) {
  const whitelist = Config.getWhitelist()
  const groupIdNum = parseInt(groupId)
  const index = whitelist.indexOf(groupIdNum)

  if (index === -1) {
    return { success: false, message: `群 ${groupId} 不在白名单中` }
  }

  whitelist.splice(index, 1)
  if (Config.saveWhitelist(whitelist)) {
    return { success: true, message: `成功将群 ${groupId} 从白名单移除` }
  }
  return { success: false, message: '移除白名单失败' }
}

/**
 * 从黑名单移除
 */
export function removeFromBlacklist(groupId) {
  const blacklist = Config.getBlacklist()
  const groupIdNum = parseInt(groupId)
  const index = blacklist.indexOf(groupIdNum)

  if (index === -1) {
    return { success: false, message: `群 ${groupId} 不在黑名单中` }
  }

  blacklist.splice(index, 1)
  if (Config.saveBlacklist(blacklist)) {
    return { success: true, message: `成功将群 ${groupId} 从黑名单移除` }
  }
  return { success: false, message: '移除黑名单失败' }
}