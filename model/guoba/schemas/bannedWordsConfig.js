/**
 * 违禁词管理配置 Schema
 */
export const bannedWordsConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '违禁词管理'
  },
  {
    component: 'Divider',
    label: '违禁词列表',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'bannedWordsList',
    label: '违禁词',
    bottomHelpMessage: '输入违禁词后按回车添加，点击 × 可删除。支持中英文、符号等任意字符。',
    component: 'Select',
    componentProps: {
      mode: 'tags',
      style: { width: '100%' },
      placeholder: '输入违禁词后按回车添加',
      tokenSeparators: [',', '，', ' ', '\n']
    }
  }
]