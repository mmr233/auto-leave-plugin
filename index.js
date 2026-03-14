import fs from 'node:fs'
import path from 'node:path'

// 加载 apps 目录下的所有模块
const apps = {}
const appsDir = path.join(process.cwd(), 'plugins/auto-leave-plugin/apps')

if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js'))

  for (const file of files) {
    try {
      const module = await import(`./apps/${file}`)
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