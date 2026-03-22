import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')
const pluginName = path.basename(pluginRoot)
const pluginTitle = '自动退群'
const packageInfo = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
const pluginVersion = packageInfo.version

export { pluginName, pluginRoot, pluginTitle, pluginVersion }
