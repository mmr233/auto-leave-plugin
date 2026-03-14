/**
 * 获取群名称
 * @param {number} groupId - 群号
 * @param {object} bot - Bot实例
 * @returns {string|null} 群名称
 */
export async function getGroupName(groupId, bot) {
  try {
    if (bot.gl && bot.gl.has(groupId)) {
      const groupInfo = bot.gl.get(groupId)
      return groupInfo?.group_name || groupInfo?.name
    }
    return null
  } catch (err) {
    logger.warn(`[自动退群] 获取群名失败: ${err.message}`)
    return null
  }
}

/**
 * 获取用户信息
 * @param {number} groupId - 群号
 * @param {number} userId - 用户ID
 * @param {object} bot - Bot实例
 */
export async function getUserInfo(groupId, userId, bot) {
  try {
    // 尝试从群成员列表获取用户信息
    if (bot.gl && bot.gl.has(groupId)) {
      const groupInfo = bot.gl.get(groupId)
      if (groupInfo && groupInfo.members && groupInfo.members.has(userId)) {
        const memberInfo = groupInfo.members.get(userId)
        return {
          nickname: memberInfo.nickname || memberInfo.card || '未知用户',
          card: memberInfo.card || '',
          role: memberInfo.role || 'member'
        }
      }
    }

    // 如果无法从缓存获取，尝试其他方式
    try {
      if (bot.pickMember) {
        const member = bot.pickMember(groupId, userId)
        const info = await member.getInfo()
        return {
          nickname: info.nickname || info.card || '未知用户',
          card: info.card || '',
          role: info.role || 'member'
        }
      }
    } catch (err) {
      logger.debug(`[自动退群] 获取用户 ${userId} 详细信息失败: ${err.message}`)
    }

    return {
      nickname: '未知用户',
      card: '',
      role: 'member'
    }
  } catch (err) {
    logger.warn(`[自动退群] 获取用户信息时出错: ${err.message}`)
    return {
      nickname: '未知用户',
      card: '',
      role: 'member'
    }
  }
}

/**
 * 检查用户是否为管理员或群主
 * @param {object} userInfo - 用户信息
 * @returns {boolean}
 */
export function isUserAdmin(userInfo) {
  return userInfo.role === 'admin' || userInfo.role === 'owner'
}

/**
 * 检查机器人是否为群管理员
 * @param {object} bot - Bot实例
 * @param {number} groupId - 群号
 */
export async function isBotAdmin(bot, groupId) {
  try {
    const botId = bot?.uin || bot?.self_id

    if (bot.gl && bot.gl.has(groupId)) {
      const groupInfo = bot.gl.get(groupId)
      if (groupInfo && groupInfo.members && groupInfo.members.has(botId)) {
        const botMember = groupInfo.members.get(botId)
        return botMember.role === 'admin' || botMember.role === 'owner'
      }
    }

    // 尝试其他方式获取
    try {
      if (bot.pickMember) {
        const member = bot.pickMember(groupId, botId)
        const info = await member.getInfo()
        return info.role === 'admin' || info.role === 'owner'
      }
    } catch (err) {
      logger.debug(`[自动退群] 获取机器人权限失败: ${err.message}`)
    }

    return false
  } catch (err) {
    logger.warn(`[自动退群] 检查机器人权限时出错: ${err.message}`)
    return false
  }
}

/**
 * 禁言用户
 * @param {object} bot - Bot实例
 * @param {number} groupId - 群号
 * @param {number} userId - 用户ID
 * @param {number} duration - 禁言时长（秒）
 */
export async function muteUser(bot, groupId, userId, duration) {
  try {
    if (bot.setGroupBan) {
      await bot.setGroupBan(groupId, userId, duration)
      return true
    } else if (bot.pickMember) {
      const member = bot.pickMember(groupId, userId)
      await member.mute(duration)
      return true
    } else if (bot.sendApi) {
      await bot.sendApi('set_group_ban', {
        group_id: groupId,
        user_id: userId,
        duration: duration
      })
      return true
    }
    return false
  } catch (err) {
    logger.error(`[自动退群] 禁言用户 ${userId} 失败: ${err.message}`)
    return false
  }
}

/**
 * 踢出用户
 * @param {object} bot - Bot实例
 * @param {number} groupId - 群号
 * @param {number} userId - 用户ID
 */
export async function kickUser(bot, groupId, userId) {
  try {
    if (bot.setGroupKick) {
      await bot.setGroupKick(groupId, userId)
      return true
    } else if (bot.pickMember) {
      const member = bot.pickMember(groupId, userId)
      await member.kick()
      return true
    } else if (bot.sendApi) {
      await bot.sendApi('set_group_kick', {
        group_id: groupId,
        user_id: userId
      })
      return true
    }
    return false
  } catch (err) {
    logger.error(`[自动退群] 踢出用户 ${userId} 失败: ${err.message}`)
    return false
  }
}

/**
 * 发送群消息
 * @param {object} bot - Bot实例
 * @param {number} groupId - 群号
 * @param {string|Array} message - 消息内容
 */
export async function sendGroupMessage(bot, groupId, message) {
  try {
    if (bot.sendGroupMsg) {
      await bot.sendGroupMsg(groupId, message)
    } else if (bot.pickGroup) {
      const group = bot.pickGroup(groupId)
      await group.sendMsg(message)
    } else if (bot.sendApi) {
      await bot.sendApi('send_group_msg', {
        group_id: groupId,
        message: message
      })
    }
  } catch (err) {
    logger.error(`[自动退群] 发送群消息失败: ${err.message}`)
    throw err
  }
}

/**
 * 退出群聊
 * @param {object} bot - Bot实例
 * @param {number} groupId - 群号
 */
export async function leaveGroup(bot, groupId) {
  try {
    if (bot.setGroupLeave) {
      await bot.setGroupLeave(groupId)
    } else if (bot.pickGroup) {
      const group = bot.pickGroup(groupId)
      await group.quit()
    } else {
      await bot.sendApi('set_group_leave', { group_id: groupId })
    }
    return true
  } catch (err) {
    logger.error(`[自动退群] 退群失败: ${err.message}`)
    return false
  }
}

/**
 * 发送私聊消息
 * @param {object} bot - Bot实例
 * @param {number} userId - 用户ID
 * @param {string} message - 消息内容
 */
export async function sendPrivateMessage(bot, userId, message) {
  try {
    if (bot.pickFriend) {
      const friend = bot.pickFriend(userId)
      await friend.sendMsg(message)
      return true
    } else if (bot.sendApi) {
      await bot.sendApi('send_private_msg', {
        user_id: userId,
        message: message
      })
      return true
    }
    return false
  } catch (err) {
    logger.error(`[自动退群] 发送私聊消息失败: ${err.message}`)
    return false
  }
}