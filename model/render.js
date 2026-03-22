import fs from 'node:fs'
import path from 'node:path'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { pluginName, pluginRoot, pluginTitle, pluginVersion } from './constant.js'

function getScale(pct = 1) {
  const scale = Math.min(2, Math.max(0.5, pct))
  return `style="transform:scale(${scale});transform-origin:top left;"`
}

class Render {
  async render(template, data = {}, options = {}) {
    const templatePath = path.join(pluginRoot, 'resources', `${template}.html`)
    if (!fs.existsSync(templatePath)) {
      throw new Error(`模板文件不存在: ${templatePath}`)
    }

    const renderName = `${pluginName}-${template.replace(/[\\/]/g, '-')}`
    const payload = {
      ...data,
      tplFile: templatePath,
      saveId: options.saveId || template.split('/').pop() || 'render',
      _res_path: `../../../plugins/${pluginName}/resources`,
      quality: 100,
      pageGotoParams: {
        waitUntil: 'networkidle0'
      },
      sys: {
        scale: getScale(options.scale || 1)
      },
      copyright: `Created By TRSS-Yunzai & ${pluginTitle}<span class="version">v${pluginVersion}</span>`
    }

    return puppeteer.screenshot(renderName, payload)
  }
}

export default new Render()
