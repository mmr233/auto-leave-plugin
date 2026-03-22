import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取插件根目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = __dirname
const packageJsonPath = path.join(pluginRoot, 'package.json')
const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const loadStartTime = Date.now()

// 初始化配置模块（确保配置目录和文件被创建）
import { Config } from './components/config.js'

// 初始化事件监听
import { initEventListener } from './model/index.js'

// 加载 apps 目录下的所有模块
const apps = {}
const appsDir = path.join(pluginRoot, 'apps')
const loadedFiles = []
const failedFiles = []

if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir)
    .filter(file => file.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))

  for (const file of files) {
    try {
      // 使用绝对路径导入
      const modulePath = path.join(appsDir, file)
      const module = await import(`file://${modulePath}`)
      for (const [name, clazz] of Object.entries(module)) {
        const key = `${file.replace('.js', '')}_${name}`
        apps[key] = clazz
      }
      loadedFiles.push(file.replace('.js', ''))
    } catch (err) {
      failedFiles.push(file)
      logger.error(`[自动退群] 加载失败: ${file}`, err)
    }
  }
}

const listenerReady = initEventListener()

const loadDuration = Date.now() - loadStartTime
logger.info('-------------------------')
logger.info(
  listenerReady
    ? `[自动退群] v${packageInfo.version} 插件已加载，开始监听群成员变化和禁言事件`
    : `[自动退群] v${packageInfo.version} 插件已加载，事件监听等待 Bot 就绪后注册`
)
logger.info(`[自动退群] 已加载 ${loadedFiles.length} 个模块文件，${Object.keys(apps).length} 个处理器，${failedFiles.length} 个失败`)
if (loadedFiles.length > 0) {
  logger.info(`[自动退群] 模块列表：${loadedFiles.join('、')}`)
}
if (failedFiles.length > 0) {
  logger.warn(`[自动退群] 加载失败模块：${failedFiles.join('、')}`)
}
logger.info(`[自动退群] 初始化耗时：${loadDuration}ms`)
logger.info('-------------------------')

export { apps }
