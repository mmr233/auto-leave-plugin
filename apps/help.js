import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../components/config.js'
import Render from '../model/render.js'
import { pluginTitle, pluginVersion } from '../model/constant.js'
import { style } from '../resources/help/imgs/config.js'

function padIcon(icon) {
  return String(icon).padStart(2, '0')
}

function processHelpList(helpList) {
  return helpList.map(group => ({
    ...group,
    list: (group.list || []).map(item => ({
      ...item,
      iconLabel: padIcon(item.icon || 0)
    }))
  }))
}

function buildTextHelp(helpList) {
  const lines = [`${pluginTitle}帮助`]

  for (const group of helpList) {
    lines.push(`\n【${group.group}】`)
    if (group.desc) {
      lines.push(group.desc)
    }
    for (const item of group.list || []) {
      lines.push(`${item.title} - ${item.desc}`)
      if (item.command) {
        lines.push(`命令：${item.command}`)
      }
    }
  }

  return lines.join('\n')
}

function buildHelpButtons() {
  if (typeof segment === 'undefined' || typeof segment.button !== 'function') {
    return null
  }

  return segment.button(
    [
      { text: '白名单', input: 'T白名单' },
      { text: '黑名单', input: 'T黑名单' },
      { text: '违禁词', input: 'T违禁词列表' }
    ],
    [
      { text: '用户黑名单', input: 'T用户黑名单' },
      { text: '更新日志', input: 'T更新日志' },
      { text: '帮助', input: 'T帮助' }
    ]
  )
}

export class AutoLeaveHelp extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:帮助`,
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [
        {
          reg: '^[tT]帮助$',
          fnc: 'allHelp'
        }
      ]
    })
  }

  getThemeData(helpCfg) {
    const colCount = Math.min(4, Math.max(Number(helpCfg.colCount) || 3, 2))
    const width = Math.min(1400, Math.max(920, colCount * 300 + 80))
    const cssVars = [
      ':root {',
      `  --page-width: ${width}px;`,
      `  --color-accent: ${style.accent};`,
      `  --color-accent-strong: ${style.accentStrong};`,
      `  --color-text: ${style.text};`,
      `  --color-text-muted: ${style.textMuted};`,
      `  --panel-bg: ${style.panelBg};`,
      `  --panel-border: ${style.panelBorder};`,
      `  --hero-bg: ${style.heroBg};`,
      `  --card-bg: ${style.cardBg};`,
      `  --card-border: ${style.cardBorder};`,
      `  --command-bg: ${style.commandBg};`,
      `  --shadow-main: ${style.shadow};`,
      '}',
      `.help-grid { grid-template-columns: repeat(${colCount}, minmax(0, 1fr)); }`
    ]

    return {
      style: `<style>${cssVars.join('\n')}</style>`,
      colCount
    }
  }

  createHelpList(e) {
    const config = Config.loadConfig()
    const helpList = [
      {
        group: '功能概览',
        desc: '自动处理低人数群、黑名单群、违禁词触发和机器人被禁言场景。',
        list: [
          {
            icon: 1,
            title: '低人数自动退群',
            desc: `群成员少于 ${config.minMemberCount} 人时自动退群`
          },
          {
            icon: 2,
            title: '违禁词触发退群',
            desc: `非白名单群艾特机器人触发 ${config.bannedWordTriggerLimit} 次后退群`
          },
          {
            icon: 3,
            title: '禁言触发退群',
            desc: `机器人被禁言达到 ${config.muteCountLimit} 次后退群`
          },
          {
            icon: 4,
            title: '黑名单群即时退群',
            desc: '机器人被拉入黑名单群时会直接退群'
          },
          {
            icon: 5,
            title: '白名单群特殊管理',
            desc: '白名单群不自动退群，但可启用违禁词禁言/踢出'
          },
          {
            icon: 6,
            title: 'T帮助',
            desc: '查看当前插件帮助面板',
            command: 'T帮助'
          }
        ]
      },
      {
        group: '群名单管理',
        desc: '这些命令仅主人可用，可在群内直接操作当前群。',
        list: [
          {
            icon: 11,
            title: '拉白 / 取消拉白',
            desc: '把群加入或移出白名单',
            command: 'T拉白 [群号] / T取消拉白 [群号]'
          },
          {
            icon: 12,
            title: '查看白名单',
            desc: '查看全部白名单群',
            command: 'T白名单'
          },
          {
            icon: 13,
            title: '拉黑 / 取消拉黑',
            desc: '把群加入或移出黑名单',
            command: 'T拉黑 [群号] / T取消拉黑 [群号]'
          },
          {
            icon: 14,
            title: '查看黑名单',
            desc: '查看全部黑名单群',
            command: 'T黑名单'
          }
        ]
      },
      {
        group: '违禁词管理',
        desc: '支持按内容或序号删除，也支持逗号批量操作。',
        list: [
          {
            icon: 21,
            title: '添加违禁词',
            desc: '支持单个或批量添加',
            command: 'T添加违禁词 词1,词2'
          },
          {
            icon: 22,
            title: '删除违禁词',
            desc: '支持按内容或序号删除',
            command: 'T删除违禁词 1,敏感词'
          },
          {
            icon: 23,
            title: '查看违禁词列表',
            desc: '查看当前全部违禁词',
            command: 'T违禁词列表'
          }
        ]
      },
      {
        group: '用户黑名单与更新',
        desc: '白名单群可联动踢出黑名单用户，更新走 Yunzai 通用更新器。',
        list: [
          {
            icon: 31,
            title: '拉黑用户 / 取消拉黑用户',
            desc: '支持直接填 QQ 或 @用户',
            command: 'T拉黑用户 123456 / T取消拉黑用户 123456'
          },
          {
            icon: 32,
            title: '查看用户黑名单',
            desc: '查看当前黑名单用户',
            command: 'T用户黑名单'
          },
          {
            icon: 33,
            title: '更新插件',
            desc: '拉取最新版本并按框架逻辑处理',
            command: 'T更新 / T强制更新 / T更新日志'
          }
        ]
      }
    ]

    if (e.isMaster) {
      helpList.push({
        group: '当前配置',
        desc: `自动退群 v${pluginVersion}`,
        list: [
          {
            icon: 41,
            title: '最少成员阈值',
            desc: `${config.minMemberCount} 人`
          },
          {
            icon: 42,
            title: '违禁词退群阈值',
            desc: `${config.bannedWordTriggerLimit} 次`
          },
          {
            icon: 43,
            title: '禁言退群阈值',
            desc: `${config.muteCountLimit} 次`
          },
          {
            icon: 44,
            title: '白名单管理状态',
            desc: config.whitelistManagement?.enabled ? '已开启' : '已关闭'
          },
          {
            icon: 45,
            title: '黑名单用户自动踢出',
            desc: config.whitelistManagement?.autoKickBlacklistedUsers ? '已开启' : '已关闭'
          },
          {
            icon: 46,
            title: '通知主人',
            desc: config.notifyMaster?.enabled ? '已开启' : '已关闭'
          }
        ]
      })
    }

    return helpList
  }

  async allHelp(e = this.e) {
    const helpCfg = {
      title: `${pluginTitle}帮助`,
      subTitle: 'AUTO LEAVE HELP',
      description: '自动退群、黑白名单、违禁词和更新管理',
      colCount: 3
    }

    const helpList = this.createHelpList(e)
    const helpGroup = processHelpList(helpList)
    const themeData = this.getThemeData(helpCfg)

    try {
      const image = await Render.render('help/index', {
        helpCfg,
        helpGroup,
        ...themeData
      }, {
        scale: 1.25,
        saveId: 'help'
      })

      const buttons = buildHelpButtons()
      return e.reply(buttons ? [image, buttons] : image)
    } catch (err) {
      logger.error('[自动退群] 渲染帮助失败:', err)
      return e.reply(buildTextHelp(helpList))
    }
  }
}
