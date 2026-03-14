import { Config } from '../../components/config.js'
import { saveUserBlacklist } from '../../utils/yunzaiConfig.js'
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