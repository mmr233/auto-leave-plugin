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
      } else if (stdout.includes('Updating') || stdout.includes('更新') || stdout.includes('files changed')) {
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

        // 更新成功后自动安装依赖
        await this.installDependencies(e)
      } else {
        await e.reply(`自动退群插件更新完成\n${stdout}`)

        // 更新成功后自动安装依赖
        await this.installDependencies(e)
      }

      logger.info(`[自动退群] 插件更新完成`)

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
  async installDependencies(e) {
    try {
      // 检查 package.json 是否存在
      const packageJsonPath = path.join(pluginPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        logger.debug('[自动退群] 未找到 package.json，跳过依赖安装')
        return
      }

      // 检查是否有依赖
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0) {
        logger.debug('[自动退群] 无依赖需要安装')
        return
      }

      await e.reply('正在安装依赖...')

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
        await e.reply(
          `依赖安装失败！\n` +
          `请手动执行: ${installCmd}\n` +
          `或检查网络连接后重试`
        )
        logger.error(`[自动退群] 依赖安装失败: ${result}`)
      } else {
        // 解析安装的依赖数量
        const addedMatch = result.match(/added (\d+) packages/i)
        const changedMatch = result.match(/changed (\d+) packages/i)
        const removedMatch = result.match(/removed (\d+) packages/i)

        let summary = []
        if (addedMatch) summary.push(`新增 ${addedMatch[1]} 个`)
        if (changedMatch) summary.push(`更新 ${changedMatch[1]} 个`)
        if (removedMatch) summary.push(`移除 ${removedMatch[1]} 个`)

        if (summary.length > 0) {
          await e.reply(`依赖安装完成：${summary.join('、')}\n请重启生效`)
        } else {
          await e.reply('依赖已是最新，请重启生效')
        }

        logger.info(`[自动退群] 依赖安装完成`)
      }

    } catch (err) {
      logger.error(`[自动退群] 依赖安装失败:`, err)
      await e.reply(
        `依赖安装出错！\n` +
        `错误: ${err.message}\n` +
        `请手动执行: pnpm install\n` +
        `或在插件目录执行: npm install`
      )
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