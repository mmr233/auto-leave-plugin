import { exec as _exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(_exec)

/**
 * 统一命令执行入口
 * @param {string} cmd - 命令
 * @param {string} cwd - 工作目录
 * @param {boolean} quiet - 安静模式（不输出日志）
 * @returns {Promise<string>} 命令输出
 */
export async function exec(cmd, cwd, quiet = false) {
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

    _exec(cmd, { cwd }, (err, stdout, stderr) => {
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
 * @param {string} cwd - 目录路径
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(cwd) {
  try {
    await exec('git rev-parse --git-dir', cwd, true)
    return true
  } catch {
    return false
  }
}

/**
 * 获取当前分支名
 * @param {string} cwd - 目录路径
 * @returns {Promise<string>}
 */
export async function getCurrentBranch(cwd) {
  try {
    const branch = await exec('git rev-parse --abbrev-ref HEAD', cwd, true)
    return branch.trim()
  } catch {
    return 'master'
  }
}

/**
 * 获取远程仓库地址
 * @param {string} cwd - 目录路径
 * @returns {Promise<string>}
 */
export async function getRemoteUrl(cwd) {
  try {
    const url = await exec('git remote get-url origin', cwd, true)
    return url.trim()
  } catch {
    return ''
  }
}

/**
 * 获取最新提交信息
 * @param {string} cwd - 目录路径
 * @param {number} count - 获取数量
 * @returns {Promise<string>}
 */
export async function getRecentCommits(cwd, count = 5) {
  try {
    const log = await exec(`git log --oneline -${count}`, cwd, true)
    return log.trim()
  } catch {
    return ''
  }
}