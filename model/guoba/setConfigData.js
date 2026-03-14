import { Config } from '../../components/config.js'
import lodash from 'lodash'

/**
 * 保存配置数据
 */
export async function setConfigData(data, { Result }) {
  try {
    const currentConfig = Config.loadConfig()

    // 处理嵌套配置
    const config = {}
    for (let [keyPath, value] of Object.entries(data)) {
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