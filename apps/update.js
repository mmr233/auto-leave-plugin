import plugin from '../../../lib/plugins/plugin.js'
import { pluginName, pluginTitle } from '../model/constant.js'

let Update = null
try {
  Update = (await import('../../other/update.js').catch(() => null))?.update
  Update ||= (await import('../../system/apps/update.ts').catch(() => null))?.update
} catch {
  logger.error(`[${pluginName}]未获取到更新js ${logger.yellow('更新功能')} 将无法使用`)
}

function createUpdater(e) {
  if (!Update) {
    e?.reply?.('未获取到 Yunzai 通用更新模块，更新功能不可用')
    return null
  }

  const updater = new Update(e)
  updater.e = e
  return updater
}

export class AutoLeaveUpdate extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:更新`,
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [
        {
          reg: '^[tT](强制)?更新$',
          fnc: 'update'
        },
        {
          reg: '^[tT]更新日志$',
          fnc: 'updateLog'
        }
      ]
    })
  }

  async update(e = this.e) {
    if (!e.isMaster) return false

    const updater = createUpdater(e)
    if (!updater) return true

    e.msg = `#${e.msg.includes('强制') ? '强制' : ''}更新${pluginName}`
    return updater.update()
  }

  async updateLog(e = this.e) {
    if (!e.isMaster) return false

    const updater = createUpdater(e)
    if (!updater) return true

    const currentPlugin = await updater.getPlugin(pluginName)
    if (currentPlugin === false) {
      await e.reply(`${pluginTitle} 插件目录不存在或不是 Git 仓库`)
      return true
    }

    return e.reply(await updater.getLog(pluginName))
  }
}
