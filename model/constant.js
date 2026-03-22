import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '..')
const pluginName = path.basename(pluginRoot)
const pluginTitle = '自动退群'

export { pluginName, pluginRoot, pluginTitle }
