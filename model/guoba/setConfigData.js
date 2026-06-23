import { Config } from '../../components/config.js'
import { saveUserBlacklist } from '../../utils/yunzaiConfig.js'
import { normalizeIdList, normalizeNotifyUsers, REVIEW_MODE } from '../inviteManagement.js'
import lodash from 'lodash'

/**
 * 保存配置数据
 */
export async function setConfigData(data, { Result }) {
  try {
    const currentConfig = Config.loadConfig()

    // 提取需要单独处理的数据
    const { bannedWordsList, whitelistGroups, blacklistGroups, blacklistUsers, ...restData } = data

    // 处理违禁词列表（GTags 组件返回数组）
    if (bannedWordsList !== undefined) {
      // 确保是数组，去重并过滤空字符串
      const uniqueWords = [...new Set(
        Array.isArray(bannedWordsList)
          ? bannedWordsList.map(word => String(word).trim()).filter(word => word.length > 0)
          : []
      )]

      if (Config.saveBannedWords(uniqueWords)) {
        logger.info(`[自动退群] 违禁词列表已更新，共 ${uniqueWords.length} 个`)
      } else {
        return Result.error('保存违禁词列表失败')
      }
    }

    // 处理白名单群聊（GSelectGroup 组件返回数组）
    if (whitelistGroups !== undefined) {
      const groupList = [...new Set(
        Array.isArray(whitelistGroups)
          ? whitelistGroups.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
          : []
      )]

      if (Config.saveWhitelist(groupList)) {
        logger.info(`[自动退群] 白名单群聊已更新，共 ${groupList.length} 个`)
      } else {
        return Result.error('保存白名单群聊失败')
      }
    }

    // 处理黑名单群聊（GSelectGroup 组件返回数组）
    if (blacklistGroups !== undefined) {
      const groupList = [...new Set(
        Array.isArray(blacklistGroups)
          ? blacklistGroups.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
          : []
      )]

      if (Config.saveBlacklist(groupList)) {
        logger.info(`[自动退群] 黑名单群聊已更新，共 ${groupList.length} 个`)
      } else {
        return Result.error('保存黑名单群聊失败')
      }
    }

    // 处理黑名单用户（GSelectFriend 组件返回数组）
    if (blacklistUsers !== undefined) {
      const userList = [...new Set(
        Array.isArray(blacklistUsers)
          ? blacklistUsers.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
          : []
      )]

      if (saveUserBlacklist(userList)) {
        logger.info(`[自动退群] 黑名单用户已更新，共 ${userList.length} 个`)
      } else {
        return Result.error('保存黑名单用户失败')
      }
    }

    // 处理嵌套配置
    const config = {}
    for (let [keyPath, value] of Object.entries(restData)) {
      lodash.set(config, keyPath, value)
    }

    if (config.groupAdmin) {
      if (Array.isArray(config.groupAdmin.whiteQQ)) {
        config.groupAdmin.whiteQQ = [...new Set(
          config.groupAdmin.whiteQQ.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
        )]
      }

      if (Array.isArray(config.groupAdmin.groupVerify?.openGroup)) {
        config.groupAdmin.groupVerify.openGroup = [...new Set(
          config.groupAdmin.groupVerify.openGroup.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
        )]
      }

      if (Array.isArray(config.groupAdmin.groupAddNotice?.openGroup)) {
        config.groupAdmin.groupAddNotice.openGroup = [...new Set(
          config.groupAdmin.groupAddNotice.openGroup.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
        )]
      }

      if (Array.isArray(config.groupAdmin.groupVerify?.successMsgs)) {
        const successMsgs = {}
        for (const item of config.groupAdmin.groupVerify.successMsgs) {
          const groupId = String(item?.groupId || '').trim()
          const msg = String(item?.msg || '').trim()
          if (!groupId || !msg) {
            continue
          }
          successMsgs[groupId] = msg
        }
        if (!successMsgs['0']) {
          successMsgs['0'] = '验证成功，欢迎入群'
        }
        config.groupAdmin.groupVerify.successMsgs = successMsgs
      }
    }

    if (config.inviteManagement) {
      const invite = config.inviteManagement
      for (const key of ['notifyGroups', 'blackGroups', 'whiteGroups']) {
        if (invite[key] !== undefined) {
          invite[key] = normalizeIdList(invite[key])
        }
      }
      if (invite.notifyUsers !== undefined) {
        invite.notifyUsers = normalizeNotifyUsers(invite.notifyUsers)
      }
      if (invite.reviewMode !== undefined) {
        const mode = Number(invite.reviewMode)
        invite.reviewMode = Object.values(REVIEW_MODE).includes(mode) ? mode : REVIEW_MODE.MANUAL
      }
      if (invite.requestExpireMinutes !== undefined) {
        invite.requestExpireMinutes = Math.max(1, Number(invite.requestExpireMinutes) || 5)
      }
      if (invite.maxPendingRequests !== undefined) {
        invite.maxPendingRequests = Math.max(1, Number(invite.maxPendingRequests) || 20)
      }
    }

    // 合并配置
    const mergedConfig = lodash.merge({}, currentConfig, config)

    // 保存配置
    if (Config.saveConfig(mergedConfig)) {
      return Result.ok({}, '保存成功~')
    } else {
      return Result.error('保存失败')
    }
  } catch (err) {
    logger.error('[自动退群] 保存配置失败:', err)
    return Result.error('保存失败：' + err.message)
  }
}
