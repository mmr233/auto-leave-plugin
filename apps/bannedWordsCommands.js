import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../../components/config.js'
import { splitByComma } from '../../utils/common.js'

/**
 * 违禁词管理
 */
export class BannedWordsHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-违禁词',
      dsc: '违禁词管理命令',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^[tT]添加违禁词\\s*(.+)$',
          fnc: 'addBannedWord'
        },
        {
          reg: '^[tT]违禁词列表$',
          fnc: 'showBannedWords'
        },
        {
          reg: '^[tT]删除违禁词\\s*(.+)$',
          fnc: 'removeBannedWord'
        }
      ]
    })
  }

  async addBannedWord(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作违禁词')
      return true
    }

    const match = e.msg.match(/^[tT]添加违禁词\s*(.+)$/)
    if (!match || !match[1]) {
      await e.reply('请输入要添加的违禁词')
      return true
    }

    const input = match[1].trim()
    const bannedWords = Config.getBannedWords()

    // 检查是否包含逗号（批量操作）
    if (input.includes('，') || input.includes(',')) {
      const wordsToAdd = splitByComma(input)
      if (wordsToAdd.length === 0) {
        await e.reply('请输入有效的违禁词')
        return true
      }

      const addedWords = []
      const existingWords = []

      for (const word of wordsToAdd) {
        if (bannedWords.includes(word)) {
          existingWords.push(word)
        } else {
          bannedWords.push(word)
          addedWords.push(word)
        }
      }

      if (addedWords.length > 0) {
        if (Config.saveBannedWords(bannedWords)) {
          let message = `成功添加 ${addedWords.length} 个违禁词：\n${addedWords.map((word, index) => `${index + 1}. ${word}`).join('\n')}`

          if (existingWords.length > 0) {
            message += `\n\n已存在的违禁词 (${existingWords.length}个)：\n${existingWords.join('、')}`
          }

          await e.reply(message)
          logger.info(`[自动退群] 批量添加违禁词: ${addedWords.join('、')}`)
        } else {
          await e.reply('添加违禁词失败')
        }
      } else {
        await e.reply(`所有违禁词都已存在：\n${existingWords.join('、')}`)
      }
    } else {
      // 单个添加
      if (bannedWords.includes(input)) {
        await e.reply(`违禁词"${input}"已存在`)
        return true
      }

      bannedWords.push(input)
      if (Config.saveBannedWords(bannedWords)) {
        await e.reply(`成功添加违禁词：\"${input}\"`)
        logger.info(`[自动退群] 添加违禁词: ${input}`)
      } else {
        await e.reply('添加违禁词失败')
      }
    }

    return true
  }

  async showBannedWords(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看违禁词')
      return true
    }

    const bannedWords = Config.getBannedWords()
    if (bannedWords.length === 0) {
      await e.reply('违禁词列表为空')
    } else {
      const msg = `违禁词列表 (${bannedWords.length}个):\n${bannedWords.map((word, index) => `${index + 1}. ${word}`).join('\n')}`
      await e.reply(msg)
    }

    return true
  }

  async removeBannedWord(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作违禁词')
      return true
    }

    const match = e.msg.match(/^[tT]删除违禁词\s*(.+)$/)
    if (!match || !match[1]) {
      await e.reply('请输入要删除的违禁词或序号')
      return true
    }

    const input = match[1].trim()
    const bannedWords = Config.getBannedWords()

    if (bannedWords.length === 0) {
      await e.reply('违禁词列表为空')
      return true
    }

    // 检查是否包含逗号（批量操作）
    if (input.includes('，') || input.includes(',')) {
      const itemsToRemove = splitByComma(input)
      if (itemsToRemove.length === 0) {
        await e.reply('请输入有效的违禁词或序号')
        return true
      }

      const removedWords = []
      const notFoundItems = []
      const invalidIndexes = []

      for (const item of itemsToRemove) {
        const num = parseInt(item)

        if (!isNaN(num) && num > 0 && num <= bannedWords.length) {
          // 按序号删除
          const index = num - 1
          const word = bannedWords[index]
          if (!removedWords.find(r => r.word === word)) {
            removedWords.push({ word, index: num })
          }
        } else if (isNaN(num)) {
          // 按内容删除
          const index = bannedWords.indexOf(item)
          if (index !== -1) {
            if (!removedWords.find(r => r.word === item)) {
              removedWords.push({ word: item, index: index + 1 })
            }
          } else {
            notFoundItems.push(item)
          }
        } else {
          invalidIndexes.push(item)
        }
      }

      if (removedWords.length > 0) {
        // 按索引降序排序，避免删除时索引错位
        removedWords.sort((a, b) => bannedWords.indexOf(b.word) - bannedWords.indexOf(a.word))

        for (const { word } of removedWords) {
          const index = bannedWords.indexOf(word)
          if (index !== -1) {
            bannedWords.splice(index, 1)
          }
        }

        if (Config.saveBannedWords(bannedWords)) {
          let message = `成功删除 ${removedWords.length} 个违禁词：\n${removedWords.map(({ word, index }) => `[${index}] ${word}`).join('\n')}`

          if (notFoundItems.length > 0) {
            message += `\n\n未找到的违禁词：\n${notFoundItems.join('、')}`
          }

          if (invalidIndexes.length > 0) {
            message += `\n\n无效的序号：\n${invalidIndexes.join('、')}`
          }

          await e.reply(message)
          logger.info(`[自动退群] 批量删除违禁词: ${removedWords.map(r => r.word).join('、')}`)
        } else {
          await e.reply('删除违禁词失败')
        }
      } else {
        let message = '没有找到要删除的违禁词'

        if (notFoundItems.length > 0) {
          message += `\n\n未找到的违禁词：\n${notFoundItems.join('、')}`
        }

        if (invalidIndexes.length > 0) {
          message += `\n\n无效的序号：\n${invalidIndexes.join('、')}`
        }

        await e.reply(message)
      }
    } else {
      // 单个删除
      const num = parseInt(input)
      if (!isNaN(num) && num > 0 && num <= bannedWords.length) {
        // 按序号删除
        const index = num - 1
        const removedWord = bannedWords[index]
        bannedWords.splice(index, 1)

        if (Config.saveBannedWords(bannedWords)) {
          await e.reply(`成功删除违禁词[${num}]：\"${removedWord}\"`)
          logger.info(`[自动退群] 按序号删除违禁词[${num}]: ${removedWord}`)
        } else {
          await e.reply('删除违禁词失败')
        }
      } else {
        // 按内容删除
        const index = bannedWords.indexOf(input)

        if (index === -1) {
          await e.reply(`违禁词\"${input}\"不存在`)
          return true
        }
        bannedWords.splice(index, 1)
        if (Config.saveBannedWords(bannedWords)) {
          await e.reply(`成功删除违禁词：\"${input}\"`)
          logger.info(`[自动退群] 按内容删除违禁词: ${input}`)
        } else {
          await e.reply('删除违禁词失败')
        }
      }
    }

    return true
  }
}