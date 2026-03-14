import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import fs from 'node:fs'
import { exec as execAsync } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'

const exec = promisify(execAsync)

// 更新锁，防止并发更新
let updateLock = false

// 插件目录
const pluginPath = path.join(process.cwd(), 'plugins/auto-leave-plugin')

// 插件名称
const pluginName = 'auto-leave-plugin'

/**
 * 统一命令执行入口
 * @param {string} cmd - 命令
 * @param {string} cwd - 工作目录
 * @param {boolean} quiet - 安静模式
 * @returns {Promise<string>} 命令输出
 */
async function runExec(cmd, cwd, quiet = false) {
  // 优先使用宿主提供的 exec（适配 TRSS-Yunzai 等）
  if (Bot.exec) {
    const { error, stdout } = await Bot.exec(cmd, { cwd, quiet })
    if (error) throw error
    return stdout
  }

  // 回退到原生 child_process
  return new Promise((resolve, reject) => {
    if (!quiet) {
      logger.mark(`[自动退群] 执行命令: ${cmd}`)
    }

    const startTime = Date.now()

    execAsync(cmd, { cwd }, (err, stdout, stderr) => {
      const elapsed = Date.now() - startTime

      if (err) {
        if (!quiet) {
          logger.error(`[自动退群] 命令执行失败: ${err.message}`)
        }
        reject(err)
      } else {
        if (!quiet) {
          logger.mark(`[自动退群] 命令完成，耗时: ${elapsed}ms`)
        }
        resolve(String(stdout).trim())
      }
    })
  })
}

/**
 * 检查是否是 git 仓库
 */
async function isGitRepo(cwd) {
  try {
    await runExec('git rev-parse --git-dir', cwd, true)
    return true
  } catch {
    return false
  }
}

/**
 * 获取当前分支名
 */
async function getCurrentBranch(cwd) {
  try {
    const branch = await runExec('git rev-parse --abbrev-ref HEAD', cwd, true)
    return branch.trim()
  } catch {
    return 'master'
  }
}

/**
 * 获取最近提交记录
 */
async function getRecentCommits(cwd, count = 5) {
  try {
    const log = await runExec(`git log --oneline -${count}`, cwd, true)
    return log.trim()
  } catch {
    return ''
  }
}

/**
 * 获取文件哈希
 */
async function getFileHash(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    return crypto.createHash('md5').update(content).digest('hex')
  } catch {
    return ''
  }
}

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
        },
        {
          reg: '^[tT]安装依赖$',
          fnc: 'installDeps',
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

      // 获取更新前的 package.json 哈希
      const pkgPath = path.join(pluginPath, 'package.json')
      const oldHash = await getFileHash(pkgPath)

      await e.reply(`开始${isForce ? '强制' : ''}更新自动退群插件...`)

      let command = ''

      if (isForce) {
        // 强制更新：重置本地修改后拉取
        command = `git fetch origin ${branch} && git reset --hard origin/${branch} && git pull`
      } else {
        // 普通更新
        command = `git pull --rebase`
      }

      const stdout = await runExec(command, pluginPath)

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

        // 检测依赖变更
        const newHash = await getFileHash(pkgPath)
        if (oldHash !== newHash) {
          await e.reply([
            '检测到依赖变更！',
            '请执行以下命令更新依赖：',
            'pnpm install',
            '',
            '或使用 T安装依赖 命令自动安装'
          ].join('\n'))
        }
      } else {
        await e.reply(`自动退群插件更新完成\n${stdout}`)

        // 检测依赖变更
        const newHash = await getFileHash(pkgPath)
        if (oldHash !== newHash) {
          await e.reply([
            '检测到依赖变更！',
            '请执行 pnpm install 更新依赖',
            '或使用 T安装依赖 命令自动安装'
          ].join('\n'))
        }
      }

      logger.info(`[自动退群] 插件更新完成`)

    } catch (err) {
      logger.error(`[自动退群] 更新失败:`, err)
      await e.reply(
        `更新失败！\n` +
        `错误: ${err.message}\n` +
        '请稍后重试或使用 T强制更新'
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

  /**
   * 安装依赖
   */
  async installDeps(e) {
    if (updateLock) {
      await e.reply('已有任务正在进行中，请稍后再试')
      return true
    }

    updateLock = true

    try {
      await e.reply('开始安装依赖...')

      // 检测包管理器
      let hasPnpm = false
      try {
        await runExec('pnpm --version', undefined, true)
        hasPnpm = true
      } catch {
        hasPnpm = false
      }

      const cmd = hasPnpm ? 'pnpm install' : 'npm install'

      try {
        await runExec(cmd, pluginPath)
        await e.reply('依赖安装完成，请重启生效')
      } catch (err) {
        await e.reply(`依赖安装失败：${err.message}\n请手动执行 ${cmd}`)
      }

    } catch (err) {
      logger.error(`[自动退群] 安装依赖失败:`, err)
      await e.reply(`安装依赖失败：${err.message}`)
    } finally {
      updateLock = false
    }

    return true
  }
}