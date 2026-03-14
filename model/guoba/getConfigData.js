import { Config } from '../../components/config.js'

/**
 * 获取配置数据
 */
export async function getConfigData() {
  const config = Config.loadConfig() || {}

  return {
    ...config
  }
}