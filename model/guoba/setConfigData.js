import { Config } from '../../components/config.js'
import lodash from 'lodash'

/**
 * 保存配置数据
 */
export async function setConfigData(data, { Result }) {
  try {
    const currentConfig = Config.loadConfig()

    // 提取违禁词数据（单独处理）
    const { bannedWordsList, ...restData } = data

    // 处理违禁词列表
    // 只有当 bannedWordsList 是有效数组时才更新
    if (Array.isArray(bannedWordsList)) {
      // 去重并过滤空字符串
      const uniqueWords = [...new Set(
        bannedWordsList
          .map(word => String(word).trim())
          .filter(word => word.length > 0)
      )]

      if (Config.saveBannedWords(uniqueWords)) {
        logger.info(`[自动退群] 违禁词列表已更新，共 ${uniqueWords.length} 个`)
      } else {
        return Result.error('保存违禁词列表失败')
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