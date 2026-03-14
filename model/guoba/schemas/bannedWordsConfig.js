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
    bottomHelpMessage: '添加违禁词，回车确认，支持批量粘贴',
    component: 'GTags',
    componentProps: {
      placeholder: '输入违禁词后按回车添加',
      allowAdd: true,
      allowDel: true,
      showPrompt: true,
      promptProps: {
        content: '请输入违禁词：',
        placeholder: '请输入违禁词',
        okText: '添加',
        rules: [
          { required: true, message: '违禁词不能为空' }
        ]
      }
    }
  }
]