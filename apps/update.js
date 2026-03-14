import plugin from '../../../lib/plugins/plugin.js'
import { exec, isGitRepo, getCurrentBranch, getRecentCommits } from '../../utils/exec.js'
import path from 'node:path'
import fs from 'node:fs'

// 更新锁，防止并发更新
let updateLock = false

// 插件目录
const pluginPath = path.join(process.cwd(), 'plugins/auto-leave-plugin')

/**
 * 插件更新命令
 */
export class UpdateHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-更新',
      dsc: '插件更新管理',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^[tT](强制)?更新$',
          fnc: 'update',
          permission: 'master'
        },
        {
          reg: '^[tT]更新日志$',
          fnc: 'updateLog',
          permission: 'master'
        }
      ]
    })
  }

  /**
   * 更新插件
   */
  async update(e) {
    if (updateLock) {
      await e.reply('已有更新任务正在进行中，请勿重复操作！')
      return true
    }

    updateLock = true

    try {
      // 检查是否是 git 仓库
      if (!await isGitRepo(pluginPath)) {
        await e.reply('当前插件目录不是 Git 仓库，无法使用更新功能')
        return true
      }

      const isForce = e.msg.includes('强制')
      const branch = await getCurrentBranch(pluginPath)

      await e.reply(`开始${isForce ? '强制' : ''}更新自动退群插件...`)

      let command = ''

      if (isForce) {
        // 强制更新：重置本地修改后拉取
        command = `git fetch origin ${branch} && git reset --hard origin/${branch} && git pull`
      } else {
        // 普通更新
        command = `git pull --rebase`
      }

      const stdout = await exec(command, pluginPath)

      // 解析更新结果
      if (stdout.includes('Already up to date') || stdout.includes('最新')) {
        await e.reply('自动退群插件已是最新版本')
      } else if (stdout.includes('Updating') || stdout.includes('更新')) {
        const numRet = /(\d+)\s*files?\s*changed/i.exec(stdout)
        if (numRet?.[1]) {
          await e.reply(`自动退群插件更新成功，共更新 ${numRet[1]} 个文件`)
        } else {
          await e.reply('自动退群插件更新成功')
        }

        // 显示最近的提交记录
        const commits = await getRecentCommits(pluginPath, 3)
        if (commits) {
          await e.reply(`最近更新：\n${commits}`)
        }
      } else {
        await e.reply(`自动退群插件更新完成\n${stdout}`)
      }

      logger.info(`[自动退群] 插件更新完成`)

    } catch (err) {
      logger.error(`[自动退群] 更新失败:`, err)
      await e.reply(
        `更新失败！\n` +
        `错误: ${err.message}\n` +
        '请稍后重试或使用 #自动退群强制更新'
      )
    } finally {
      updateLock = false
    }

    return true
  }

  /**
   * 查看更新日志
   */
  async updateLog(e) {
    try {
      if (!await isGitRepo(pluginPath)) {
        await e.reply('当前插件目录不是 Git 仓库，无法查看更新日志')
        return true
      }

      const log = await getRecentCommits(pluginPath, 10)

      if (!log) {
        await e.reply('暂无更新日志')
        return true
      }

      await e.reply(`自动退群插件更新日志：\n${log}`)

    } catch (err) {
      logger.error(`[自动退群] 获取更新日志失败:`, err)
      await e.reply('获取更新日志失败')
    }

    return true
  }
}