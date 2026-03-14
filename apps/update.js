import plugin from '../../../lib/plugins/plugin.js'
import { exec, isGitRepo, getCurrentBranch, getRecentCommits } from '../utils/exec.js'
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
      if (stdout.includes('Already up to date') || stdout.includes('最新') || stdout.includes('up to date')) {
        await e.reply('自动退群插件已是最新版本')
        return true
      }

      // 构建更新消息
      let messages = ['自动退群插件更新成功']

      // 解析更新的文件数
      const numRet = /(\d+)\s*files?\s*changed/i.exec(stdout)
      if (numRet?.[1]) {
        messages[0] += `，共更新 ${numRet[1]} 个文件`
      }

      // 获取最近提交记录
      const commits = await getRecentCommits(pluginPath, 3)
      if (commits) {
        messages.push(`最近更新：\n${commits}`)
      }

      // 安装依赖
      const depResult = await this.installDependencies()
      if (depResult) {
        messages.push(depResult)
      }

      // 合并发送一条消息
      await e.reply(messages.join('\n\n'))

      // 更新成功后自动重启
      logger.info(`[自动退群] 插件更新完成，准备重启...`)
      await this.autoRestart(e)

    } catch (err) {
      logger.error(`[自动退群] 更新失败:`, err)
      await e.reply(
        `更新失败！\n` +
        `错误: ${err.message}\n` +
        '请稍后重试或使用 t强制更新'
      )
    } finally {
      updateLock = false
    }

    return true
  }

  /**
   * 安装/更新依赖
   */
  async installDependencies() {
    try {
      // 检查 package.json 是否存在
      const packageJsonPath = path.join(pluginPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return null
      }

      // 检查是否有依赖
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0) {
        return null
      }

      // 优先使用 pnpm，其次 npm
      let installCmd = 'pnpm install'
      let managerName = 'pnpm'

      // 检测包管理器
      const pnpmLock = path.join(pluginPath, 'pnpm-lock.yaml')
      const npmLock = path.join(pluginPath, 'package-lock.json')
      const yarnLock = path.join(pluginPath, 'yarn.lock')

      if (fs.existsSync(npmLock)) {
        installCmd = 'npm install'
        managerName = 'npm'
      } else if (fs.existsSync(yarnLock)) {
        installCmd = 'yarn install'
        managerName = 'yarn'
      }

      logger.info(`[自动退群] 使用 ${managerName} 安装依赖`)

      const result = await exec(installCmd, pluginPath)

      // 检查安装结果
      if (result.includes('ERR_') || result.includes('error')) {
        logger.error(`[自动退群] 依赖安装失败: ${result}`)
        return `⚠️ 依赖安装失败，请手动执行: ${installCmd}`
      }

      // 解析安装的依赖数量
      const addedMatch = result.match(/added (\d+) packages/i)
      const changedMatch = result.match(/changed (\d+) packages/i)
      const removedMatch = result.match(/removed (\d+) packages/i)

      let summary = []
      if (addedMatch) summary.push(`新增 ${addedMatch[1]} 个`)
      if (changedMatch) summary.push(`更新 ${changedMatch[1]} 个`)
      if (removedMatch) summary.push(`移除 ${removedMatch[1]} 个`)

      if (summary.length > 0) {
        logger.info(`[自动退群] 依赖安装完成: ${summary.join('、')}`)
        return `📦 依赖: ${summary.join('、')}`
      }

      return null

    } catch (err) {
      logger.error(`[自动退群] 依赖安装失败:`, err)
      return `⚠️ 依赖安装出错: ${err.message}`
    }
  }

  /**
   * 自动重启
   */
  async autoRestart(e) {
    try {
      // 延迟2秒后重启，给用户看到消息
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 尝试调用 Yunzai 的重启命令
      if (typeof restart === 'function') {
        await e.reply('🔄 更新完成，正在重启...')
        restart()
      } else if (Bot && Bot.restart) {
        await e.reply('🔄 更新完成，正在重启...')
        Bot.restart()
      } else {
        await e.reply('✅ 更新完成，请手动重启生效')
      }
    } catch (err) {
      logger.error(`[自动退群] 自动重启失败:`, err)
      await e.reply('✅ 更新完成，请手动重启生效')
    }
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