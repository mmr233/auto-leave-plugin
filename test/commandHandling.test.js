import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-commands-'))
const runtimePlugin = path.join(runtimeRoot, 'plugins', 'auto-leave-plugin')
fs.mkdirSync(path.join(runtimeRoot, 'lib', 'plugins'), { recursive: true })
fs.mkdirSync(path.join(runtimeRoot, 'lib', 'puppeteer'), { recursive: true })
fs.writeFileSync(path.join(runtimeRoot, 'package.json'), JSON.stringify({ type: 'module' }))
fs.writeFileSync(path.join(runtimeRoot, 'lib', 'plugins', 'plugin.js'), 'export default class plugin { constructor(options) { Object.assign(this, options) } }')
fs.writeFileSync(path.join(runtimeRoot, 'lib', 'puppeteer', 'puppeteer.js'), 'export default {}')
for (const directory of ['apps', 'components', 'config', 'model', 'resources', 'utils']) {
  fs.cpSync(path.join(pluginRoot, directory), path.join(runtimePlugin, directory), { recursive: true })
}
fs.copyFileSync(path.join(pluginRoot, 'package.json'), path.join(runtimePlugin, 'package.json'))
fs.symlinkSync(path.join(pluginRoot, 'node_modules'), path.join(runtimePlugin, 'node_modules'), 'junction')
process.chdir(runtimeRoot)
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
globalThis.segment = { at: qq => ({ type: 'at', qq }), image: file => ({ type: 'image', file }) }
globalThis.Bot = { cfg: { master: [] } }

const load = file => import(pathToFileURL(path.join(runtimePlugin, file)).href)
const admin = await load('apps/groupAdminCommands.js')
const invite = await load('apps/inviteManagement.js')
const lists = await load('apps/listCommands.js')
const users = await load('apps/userBlacklistCommands.js')
const words = await load('apps/bannedWordsCommands.js')
const help = await load('apps/help.js')
const update = await load('apps/update.js')
const { Config } = await load('components/config.js')
const runtime = await load('model/groupAdminRuntime.js')
const { getUserBlacklist } = await load('utils/yunzaiConfig.js')
const { getCommandText } = await load('utils/command.js')
const { extractAtIds, parseMuteCommand } = await load('utils/groupAdmin.js')
const { decideStayReview } = await load('model/stayReview.js')
const { GroupBannedWords } = await load('model/groupAdminConfig.js')

function mixedEvent(text, options = {}) {
  const metadata = '{"title":"t拒绝加群","id":76543210}'
  const message = [
    { type: 'reply', data: { id: 76543210 } },
    { type: 'at', data: { qq: '10001' } },
    { type: 'face', data: { id: '98765' } },
    { type: 'json', data: metadata },
    { type: 'text', data: { text } },
    { type: 'image', data: { file: 'image-12345' } }
  ]
  return {
    self_id: '10001',
    msg: `${metadata}${text.trim()}`,
    raw_message: `[CQ:reply,id=76543210][CQ:at,qq=10001][CQ:face,id=98765][CQ:json,data=...]${text}`,
    message,
    ...options
  }
}

async function dispatch(handler, e) {
  handler.e = e
  for (const rule of handler.rule) {
    if (rule.reg.test(e.msg)) {
      const result = await handler[rule.fnc](e)
      if (result !== false) return result
    }
  }
  return false
}

const commandCases = [
  [admin.GroupAdminCommands, {
    muteMember: 't禁言5分钟', unmuteMember: 't解禁', muteAll: 't全体禁言',
    kickMember: 't踢黑', batchKickBlacklist: 't批量踢黑 90009', setAdmin: 't设置管理',
    setUserTitle: 't设置头衔 测试', applyOwnTitle: 't申请头衔 测试', muteList: 't查看禁言列表',
    relieveAllMute: 't解除全部禁言', neverSpeak: 't查看从未发言的人', rankingList: 't查看不活跃排行榜',
    recentlyJoined: 't查看最近入群记录', noactive: 't查看5天没发言的人', sendNotice: 't发通知 消息',
    timeMute: 't定时禁言12:00', handleGroupAdd: 't开启加群通知',
    handleGroupRequestAction: 't同意入群', toggleRequestVerify: 't开启申请免验证',
    essenceMessage: 't加精', autistic: 't我要自闭5分钟'
  }],
  [admin.GroupBannedWordsCommands, {
    add: 't新增模糊踢违禁词内容', deleteWord: 't删除违禁词内容', query: 't查看违禁词内容',
    list: 't违禁词列表', muteTime: 't设置违禁词禁言时间60', prohibitedTitle: 't增加头衔屏蔽词内容',
    prohibitedTitlePattern: 't切换头衔屏蔽词匹配模式', help: 't违禁词帮助'
  }],
  [admin.GroupVoteCommands, {
    initiate: 't投票禁言90009', follow: 't支持投票90009', switchVote: 't启用投票禁言',
    settings: 't投票设置最低票数5'
  }],
  [admin.GroupVerifyCommands, {
    reverify: 't重新验证90009', reverifyNeverSpeak: 't重新验证从未发言的人',
    pass: 't绕过验证90009', unblockVerification: 't验证解黑90009', switchVerify: 't开启验证',
    switchMode: 't切换验证模式', setOvertime: 't设置验证超时时间60秒'
  }],
  [admin.GroupAnnounceCommands, {
    addAnnounce: 't发群公告 内容', deleteAnnounce: 't删群公告1', getAnnounce: 't查群公告'
  }],
  [invite.BotInviteConfirmHandler, { handleConfirm: 't确认加群 123456' }],
  [invite.BotInviteManageCommands, {
    setReviewMode: 't群邀请审核人工审核', manageInviteList: 't添加邀请黑名单群123456',
    viewInviteList: 't查看邀请黑名单群', manageNotifyGroup: 't添加邀请通知群123456',
    viewNotifyGroups: 't查看邀请通知群', viewInviteConfig: 't查看群邀请审核'
  }],
  [lists.WhitelistHandler, { addWhitelist: 't拉白123456', showWhitelist: 't白名单', removeWhitelist: 't取消拉白123456' }],
  [lists.BlacklistHandler, { addBlacklist: 't拉黑群123456', showBlacklist: 't群黑名单', removeBlacklist: 't取消拉黑群123456' }],
  [users.UserBlacklistHandler, {
    addUserBlacklist: 't拉黑用户 90009', addUsersBlacklist: 't批量拉黑 90009',
    removeUserBlacklist: 't取消拉黑用户90009', showUserBlacklist: 't用户黑名单'
  }],
  [words.BannedWordsHandler, { addBannedWord: 't添加违禁词 内容', showBannedWords: 't违禁词列表', removeBannedWord: 't删除违禁词 内容' }],
  [help.AutoLeaveHelp, { allHelp: 't帮助' }],
  [update.AutoLeaveUpdate, { update: 't强制更新', updateLog: 't更新日志' }]
]

test('every command rule dispatches from text in mixed messages', async () => {
  for (const [Handler, cases] of commandCases) {
    const names = [...new Set(new Handler().rule.map(rule => rule.fnc))]
    assert.deepEqual(new Set(Object.keys(cases)), new Set(names), Handler.name)
    const originals = new Map(names.map(name => [name, Handler.prototype[name]]))
    try {
      for (const name of names) Handler.prototype[name] = async () => name
      const handler = new Handler()
      for (const [name, command] of Object.entries(cases)) {
        assert.equal(await dispatch(handler, mixedEvent(command)), name, `${Handler.name}.${name}`)
        assert.equal(await dispatch(handler, mixedEvent(`😊${command}`)), name, `${Handler.name}.${name} with emoji`)
      }
    } finally {
      for (const [name, original] of originals) Handler.prototype[name] = original
    }
  }
})

test('text extraction preserves real content and ignores all metadata', () => {
  const e = mixedEvent('t发群公告 内容 😊')
  assert.equal(getCommandText(e), 't发群公告 内容 😊')
  assert.equal(getCommandText({ raw_message: '[CQ:reply,id=12345][CQ:face,id=999]t确认加群 123456' }), 't确认加群 123456')
  assert.equal(getCommandText({ msg: 't确认加群', message: [{ type: 'json', data: '{"text":"t确认加群"}' }] }), '')
  assert.equal(getCommandText({ hasAlias: true, msg: 't开启验证', message: [{ type: 'text', text: '机器人t开启验证' }] }), 't开启验证')
  assert.equal(getCommandText({ hasAlias: true, msg: 't开启验证{"type":"card"}', message: [
    { type: 'text', text: '机器人t开启验证' }, { type: 'json', data: '{"type":"card"}' }
  ] }), 't开启验证')
  assert.equal(getCommandText({ message: [
    { type: 'text', text: 't确认加群 123' }, { type: 'at', qq: '10001' }, { type: 'text', text: '456' }
  ] }), 't确认加群 123 456')
})

test('a card between command text segments is ignored by matching and parsing', async () => {
  const Handler = admin.GroupAnnounceCommands
  const original = Handler.prototype.deleteAnnounce
  try {
    Handler.prototype.deleteAnnounce = async e => getCommandText(e)
    const handler = new Handler()
    const metadata = '{"id":12345,"title":"t拒绝加群"}'
    const e = mixedEvent('', {
      msg: `t删群公告${metadata}1`,
      message: [
        { type: 'text', text: 't删群公告' }, { type: 'json', data: metadata },
        { type: 'text', text: '1' }
      ]
    })
    assert.equal(await dispatch(handler, e), 't删群公告1')
  } finally {
    Handler.prototype.deleteAnnounce = original
  }
})

test('mentions ignore the bot and metadata, and a large duration is not a QQ number', () => {
  const e = mixedEvent('t禁言 100000秒', {
    message: [
      { type: 'at', qq: '10001' },
      { type: 'text', text: 't禁言 ' },
      { type: 'at', qq: '90009' },
      { type: 'text', text: ' 100000秒' },
      { type: 'face', data: { id: '99999' } }
    ]
  })
  assert.deepEqual(extractAtIds(e), [90009])
  assert.deepEqual(parseMuteCommand(e), { target: '90009', time: 100000, unit: '秒' })
})

test('mixed bulk blacklist commands do not blacklist the bot or reply and face IDs', async () => {
  const replies = []
  const e = mixedEvent('', {
    isMaster: true,
    msg: 't批量拉黑80008 😊',
    message: [
      { type: 'reply', id: 76543210 }, { type: 'at', qq: '10001' },
      { type: 'text', text: 't批量拉黑 ' }, { type: 'at', qq: '90009' },
      { type: 'face', data: { id: '98765' } }, { type: 'text', text: ' 80008 😊' }
    ],
    async reply(message) { replies.push(message) }
  })
  await dispatch(new users.UserBlacklistHandler(), e)
  assert.deepEqual(getUserBlacklist().map(Number).sort(), [80008, 90009])
  assert.match(replies[0], /新增 2 个/)
})

test('ambiguous split IDs do not add unintended users to a blacklist', async () => {
  for (const text of ['t批量拉黑 123456😊789012', 't批量拉黑 9️⃣']) {
    const e = mixedEvent('', {
      isMaster: true, msg: text, message: [{ type: 'text', text }], async reply() {}
    })
    assert.equal(await dispatch(new users.UserBlacklistHandler(), e), false)
  }
  assert.deepEqual(getUserBlacklist().map(Number).sort(), [80008, 90009])
})

test('group request approval and rejection use only the explicit text action', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.noticeEnabled = true
  config.groupAdmin.groupAddNotice.openGroup = [123456]
  Config.saveConfig(config)
  let nextMessageId = 7000
  const calls = []
  const group = { is_admin: true, async sendMsg() { return { message_id: ++nextMessageId } } }
  const bot = {
    self_id: '10001', pickGroup: () => group,
    async sendApi(action, params) {
      if (action === 'get_stranger_info') return { data: { nickname: '申请人' } }
      if (action === 'set_group_add_request') { calls.push(params); return { status: 'ok', retcode: 0 } }
      throw new Error(`unexpected action: ${action}`)
    }
  }
  for (const [index, command, expected] of [[1, '😊t同意入群👍', true], [2, 't拒绝入群👍', false]]) {
    await runtime.handleGroupRequestForAdmin({
      bot, self_id: '10001', request_type: 'group', sub_type: 'add',
      group_id: 123456, user_id: 90000 + index, flag: `flag-${index}`
    })
    const replies = []
    const e = mixedEvent(command, {
      bot, group, group_id: 123456, user_id: 55555, isMaster: true,
      async getReply() { return { message_id: 7000 + index } },
      async reply(message) { replies.push(message) }
    })
    await dispatch(new admin.GroupAdminCommands(), e)
    assert.equal(calls.at(-1)?.approve, expected)
    assert.match(replies[0], expected ? /已同意/ : /已拒绝/)
  }
  assert.equal(calls.length, 2)
})

test('mixed group unmute ignores a mute command embedded in card metadata', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.commandsEnabled = true
  Config.saveConfig(config)
  const calls = []
  const group = { is_admin: true, async muteAll(enable) { calls.push(enable) } }
  const bot = { self_id: '10001', pickGroup: () => group }
  const e = mixedEvent('t全体解禁', {
    bot, group, group_id: 123456, user_id: 55555, isMaster: true,
    msg: '{"text":"t全体禁言"}t全体解禁',
    message: [{ type: 'json', data: '{"text":"t全体禁言"}' }, { type: 'text', text: 't全体解禁' }],
    async reply() {}
  })
  await dispatch(new admin.GroupAdminCommands(), e)
  assert.deepEqual(calls, [false])
})

test('free-form command content retains Unicode emoji and excludes card metadata', async () => {
  const e = mixedEvent('😊t添加违禁词 测试😊', { isMaster: true, async reply() {} })
  await dispatch(new words.BannedWordsHandler(), e)
  assert.ok(Config.getBannedWords().includes('测试😊'))
  assert.ok(!Config.getBannedWords().some(word => word.includes('76543210')))
})

test('ambiguous review decisions fail closed', async () => {
  assert.equal((await decideStayReview({ requestId: 'anything' }, undefined, {})).ok, false)
  assert.equal((await runtime.handleGroupRequestAction({}, {}, undefined)).ok, false)
})

test('vote action and target are determined by the command, not later text', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.voteEnabled = true
  config.groupAdmin.voteBan = false
  config.groupAdmin.voteKick = true
  config.groupAdmin.veto = false
  Config.saveConfig(config)
  const replies = []
  const options = {
    group_id: 123456, user_id: 55555, isMaster: true, group: { is_admin: true },
    async reply(value) { replies.push(value) }
  }

  await dispatch(new admin.GroupVoteCommands(), mixedEvent('t启用投票禁言', options))
  assert.equal(Config.loadConfig().groupAdmin.voteBan, true)
  assert.equal(Config.loadConfig().groupAdmin.voteKick, true)

  const current = Config.loadConfig()
  current.groupAdmin.voteKick = false
  Config.saveConfig(current)
  await dispatch(new admin.GroupVoteCommands(), mixedEvent('t投票踢人90009 禁言', options))
  assert.match(replies.at(-1), /t启用投票踢人/)

  const handler = new admin.GroupVoteCommands()
  handler.vote['10001:123456:90009'] = { supportCount: 1, opposeCount: 0, list: [], type: 'Ban' }
  await dispatch(handler, mixedEvent('t反对投票90009 我不支持', options))
  assert.equal(handler.vote['10001:123456:90009'].supportCount, 1)
  assert.equal(handler.vote['10001:123456:90009'].opposeCount, 1)
  delete handler.vote['10001:123456:90009']
})

test('vote state survives a new handler for each message and stays isolated by bot', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.voteEnabled = true
  config.groupAdmin.voteKick = true
  config.groupAdmin.veto = false
  config.groupAdmin.minNum = 10
  config.groupAdmin.outTime = 0.1
  Config.saveConfig(config)
  const group = { is_admin: true }
  const bot = {
    self_id: '10001', pickGroup: () => group,
    async sendApi(action) {
      if (action === 'get_group_member_info') return { data: { user_id: 90009, role: 'member' } }
      throw new Error(`unexpected action: ${action}`)
    }
  }
  const replies = []
  const options = {
    bot, group, group_id: 123456, user_id: 55555, isMaster: true,
    async reply(value) { replies.push(value) }
  }
  await dispatch(new admin.GroupVoteCommands(), mixedEvent('t投票踢人90009', options))
  assert.match(String(replies[0]), /投票已发起/)
  await dispatch(new admin.GroupVoteCommands(), mixedEvent('t反对投票90009 😊', { ...options, user_id: 55556 }))
  assert.match(replies[1], /支持：1 反对：1/)
  await dispatch(new admin.GroupVoteCommands(), mixedEvent('t支持投票90009', { ...options, self_id: '10002', user_id: 55557 }))
  assert.match(replies[2], /未找到对应投票/)
  await new Promise(resolve => setTimeout(resolve, 130))
})

test('title-filter payload is not mistaken for a view action', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.bannedWordsEnabled = true
  Config.saveConfig(config)
  const e = mixedEvent('t增加头衔屏蔽词查看', {
    group_id: 123456, user_id: 55555, isMaster: true, group: { is_admin: true }, async reply() {}
  })
  await dispatch(new admin.GroupBannedWordsCommands(), e)
  assert.ok(GroupBannedWords.getTitleBannedWords(123456).includes('查看'))
})

test('cleanup confirmation accepts a mixed message without cancelling', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.commandsEnabled = true
  Config.saveConfig(config)
  const replies = []
  let finished = false
  const handler = new admin.GroupAdminCommands()
  handler.e = mixedEvent('t确认清理😊', { async reply(value) { replies.push(value) } })
  handler.finish = () => { finished = true }
  await handler.confirmCleanup({})
  assert.equal(finished, true)
  assert.deepEqual(replies, [])
})

test('announcement forwarding removes the command without mutating or forwarding the quote', async () => {
  const config = Config.loadConfig()
  config.groupAdmin.enabled = true
  config.groupAdmin.commandsEnabled = true
  Config.saveConfig(config)
  const replies = []
  const message = [
    { type: 'reply', id: 76543210 }, { type: 'at', qq: '10001' },
    { type: 'text', data: { text: '😊t发' } }, { type: 'face', id: 123 },
    { type: 'text', text: '通知 大家好 😊' }, { type: 'image', url: 'image' }
  ]
  const e = mixedEvent('', {
    group_id: 123456, user_id: 55555, isMaster: true, group: { is_admin: true },
    msg: '😊t发通知大家好 😊', message,
    async reply(value) { replies.push(value) }
  })
  await dispatch(new admin.GroupAdminCommands(), e)
  assert.deepEqual(replies[0], [
    { type: 'at', qq: 'all' }, { type: 'face', id: 123 },
    { type: 'text', text: '大家好 😊' }, { type: 'image', url: 'image' }
  ])
  assert.equal(message[2].data.text, '😊t发')
})

test('announcement forwarding removes a configured bot alias as well as the command', async () => {
  const replies = []
  const e = mixedEvent('', {
    group_id: 123456, user_id: 55555, isMaster: true, group: { is_admin: true },
    hasAlias: true, msg: 't发通知 大家好', message: [{ type: 'text', text: '机器人t发通知 大家好' }],
    async reply(value) { replies.push(value) }
  })
  await dispatch(new admin.GroupAdminCommands(), e)
  assert.deepEqual(replies[0], [{ type: 'at', qq: 'all' }, { type: 'text', text: '大家好' }])
})
