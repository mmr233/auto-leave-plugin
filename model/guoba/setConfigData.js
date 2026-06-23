import { Config } from '../../components/config.js'
import { saveUserBlacklist } from '../../utils/yunzaiConfig.js'
import { normalizeNotifyUsers, REVIEW_MODE } from '../inviteManagement.js'
import lodash from 'lodash'

function normalizeGroupSelectValues(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  const groups = []

  for (const item of list) {
    const raw = typeof item === 'object' && item !== null
      ? (item.group_id ?? item.groupId ?? item.value ?? item.id)
      : item
    const groupId = parseInt(raw)
    if (!isNaN(groupId) && groupId > 0) {
      groups.push(groupId)
    }
  }

  return [...new Set(groups)]
}

function normalizeFriendSelectValues(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  const users = []

  for (const item of list) {
    const raw = typeof item === 'object' && item !== null
      ? (item.user_id ?? item.userId ?? item.value ?? item.id ?? item.qq)
      : item
    const userId = parseInt(raw)
    if (!isNaN(userId) && userId > 0) {
      users.push(userId)
    }
  }

  return [...new Set(users)]
}

/**
 * 保存配置数据
 */
export async function setConfigData(data, { Result }) {
  try {
    const currentConfig = Config.loadConfig()

    // 提取需要单独处理的数据
    const { bannedWordsList, whitelistGroups, blacklistGroups, blacklistUsers, blacklistUsersManual, ...restData } = data

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
      const groupList = normalizeGroupSelectValues(whitelistGroups)

      if (Config.saveWhitelist(groupList)) {
        logger.info(`[自动退群] 白名单群聊已更新，共 ${groupList.length} 个`)
      } else {
        return Result.error('保存白名单群聊失败')
      }
    }

    // 处理黑名单群聊（GSelectGroup 组件返回数组）
    if (blacklistGroups !== undefined) {
      const groupList = normalizeGroupSelectValues(blacklistGroups)

      if (Config.saveBlacklist(groupList)) {
        logger.info(`[自动退群] 黑名单群聊已更新，共 ${groupList.length} 个`)
      } else {
        return Result.error('保存黑名单群聊失败')
      }
    }

    // 处理黑名单用户（好友选择 + 手动 QQ，统一保存到 Yunzai 用户黑名单）
    if (blacklistUsers !== undefined || blacklistUsersManual !== undefined) {
      const userList = normalizeFriendSelectValues([
        ...(Array.isArray(blacklistUsers) ? blacklistUsers : []),
        ...(Array.isArray(blacklistUsersManual) ? blacklistUsersManual : [])
      ])

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
        config.groupAdmin.whiteQQ = normalizeFriendSelectValues(config.groupAdmin.whiteQQ)
      }

      if (config.groupAdmin.groupVerify?.openGroup !== undefined) {
        config.groupAdmin.groupVerify.openGroup = normalizeGroupSelectValues(config.groupAdmin.groupVerify.openGroup)
      }

      if (config.groupAdmin.groupAddNotice?.openGroup !== undefined) {
        config.groupAdmin.groupAddNotice.openGroup = normalizeGroupSelectValues(config.groupAdmin.groupAddNotice.openGroup)
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
          invite[key] = normalizeGroupSelectValues(invite[key])
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

    // 合并配置，数组字段必须整体替换，避免删除选择项后旧值按下标残留。
    const mergedConfig = lodash.mergeWith({}, currentConfig, config, (objValue, srcValue) => {
      if (Array.isArray(srcValue)) {
        return srcValue
      }
      return undefined
    })

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
