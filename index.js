import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取插件根目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = __dirname

// 加载 apps 目录下的所有模块
const apps = {}
const appsDir = path.join(pluginRoot, 'apps')

if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js'))

  for (const file of files) {
    try {
      // 使用绝对路径导入
      const modulePath = path.join(appsDir, file)
      const module = await import(`file://${modulePath}`)
      for (const [name, clazz] of Object.entries(module)) {
        const key = `${file.replace('.js', '')}_${name}`
        apps[key] = clazz
      }
      logger.info(`[自动退群] 加载模块: ${file}`)
    } catch (err) {
      logger.error(`[自动退群] 加载失败: ${file}`, err)
    }
  }
}

logger.info(`[自动退群] 插件加载完成，共 ${Object.keys(apps).length} 个模块`)

export { apps }