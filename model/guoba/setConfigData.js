import { Config } from '../../components/config.js'
import lodash from 'lodash'

/**
 * 保存配置数据
 */
export async function setConfigData(data, { Result }) {
  try {
    const currentConfig = Config.loadConfig()

    // 提取违禁词数据（单独处理）
    const { bannedWords, bannedWordsCount, ...restData } = data

    // 处理违禁词列表
    if (bannedWords !== undefined) {
      const wordsArray = bannedWords
        .split('\n')
        .map(word => word.trim())
        .filter(word => word.length > 0)

      // 去重
      const uniqueWords = [...new Set(wordsArray)]

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