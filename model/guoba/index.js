import { pluginInfo } from './schemas/pluginInfo.js'
import { baseConfigSchema } from './schemas/baseConfig.js'
import { messageConfigSchema } from './schemas/messageConfig.js'
import { managementConfigSchema } from './schemas/managementConfig.js'
import { notificationConfigSchema } from './schemas/notificationConfig.js'
import { getConfigData } from './getConfigData.js'
import { setConfigData } from './setConfigData.js'

export function supportGuoba() {
  return {
    pluginInfo,
    configInfo: {
      schemas: [
        ...baseConfigSchema,
        ...messageConfigSchema,
        ...managementConfigSchema,
        ...notificationConfigSchema
      ],
      getConfigData,
      setConfigData
    }
  }
}