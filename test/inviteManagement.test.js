import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-plugin-test-'))
process.chdir(tempRoot)

globalThis.logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}
globalThis.Bot = { cfg: { master: [] } }

const inviteModule = await import(
  `${pathToFileURL(path.join(testRoot, 'model/inviteManagement.js')).href}?test=${Date.now()}`
)
const yunzaiConfig = await import(
  `${pathToFileURL(path.join(testRoot, 'utils/yunzaiConfig.js')).href}?test=${Date.now()}`
)
const groupAdminUtils = await import(
  `${pathToFileURL(path.join(testRoot, 'utils/groupAdmin.js')).href}?test=${Date.now()}`
)

function createInviteConfig(overrides = {}) {
  return inviteModule.getInviteConfig({
    minMemberCount: 50,
    inviteManagement: {
      enabled: true,
      reviewMode: 2,
      requestExpireMinutes: 5,
      maxPendingRequests: 20,
      allowInviterConfirm: true,
      notifyGroups: [],
      notifyUsers: [],
      blackGroups: [],
      whiteGroups: [],
      pendingRequests: [],
      approvedGroups: [],
      approvedGroupStates: [],
      precheckMemberCount: true,
      excludeBotFromPrecheck: true,
      precheckMode: 'reject',
      precheckFailureAction: 'manual',
      notifyMasterOnPrecheckReject: true,
      ...overrides
    }
  })
}

test('precheck rejects low member counts and accepts the threshold', () => {
  const service = new inviteModule.InviteManagementService({
    bot: { self_id: '10001' }
  })
  service.rootConfig = { minMemberCount: 50 }
  service.config = createInviteConfig()

  assert.equal(service.evaluatePrecheck({ memberCount: 49 }).passed, false)
  assert.equal(service.evaluatePrecheck({ memberCount: 50 }).passed, true)
  assert.equal(service.evaluatePrecheck({ memberCount: null }).passed, false)
  assert.equal(service.evaluatePrecheck({ memberCount: null }).memberCount, null)
  assert.match(service.evaluatePrecheck({ memberCount: null }).reason, /无法获取/)
})

test('precheck can count the invited bot without counting unknown membership', () => {
  const service = new inviteModule.InviteManagementService({
    bot: { self_id: '10001' }
  })
  service.rootConfig = { minMemberCount: 50 }
  service.config = createInviteConfig({ excludeBotFromPrecheck: false })

  assert.equal(service.evaluatePrecheck({ memberCount: 49 }).passed, true)
  const failed = service.evaluatePrecheck({ memberCount: 48 })
  assert.equal(failed.passed, false)
  assert.equal(failed.memberCount, 48)
  assert.match(failed.reason, /预计群成员数量 49/)
  assert.equal(service.evaluatePrecheck({ memberCount: null }).passed, false)
  assert.equal(service.evaluatePrecheck({ memberCount: 0 }).passed, false)

  service.config = createInviteConfig({ excludeBotFromPrecheck: false, precheckMode: 'warn' })
  assert.match(service.evaluatePrecheck({ memberCount: 48 }).reason, /预计群成员数量 49/)
  assert.equal(service.evaluatePrecheck({ memberCount: 49 }).reason, '')
})

test('invite review notice shows the target group count or unknown', () => {
  const service = new inviteModule.InviteManagementService({
    bot: { self_id: '10001' }
  })
  assert.match(service.buildReviewMessage({ groupId: '123456', memberCount: 49 }), /当前人数：49/)
  assert.match(service.buildReviewMessage({ groupId: '123456', memberCount: null }), /当前人数：未知/)
})

test('Guoba saves and reads the invited-bot counting option', async () => {
  const { setConfigData } = await import(
    `${pathToFileURL(path.join(testRoot, 'model/guoba/setConfigData.js')).href}?test=${Date.now()}`
  )
  const { Config } = await import(
    pathToFileURL(path.join(testRoot, 'components/config.js')).href
  )
  const result = await setConfigData(
    { 'inviteManagement.excludeBotFromPrecheck': false },
    { Result: { ok: () => ({ ok: true }), error: message => ({ ok: false, message }) } }
  )

  assert.equal(result.ok, true)
  assert.equal(Config.loadConfig().inviteManagement.excludeBotFromPrecheck, false)
  assert.equal(inviteModule.getInviteConfig().excludeBotFromPrecheck, false)
})

test('ignores invitations whose target is another user', () => {
  const event = {
    self_id: '2701177370',
    user_id: '3356510984',
    invited_id: '3853386180'
  }

  assert.equal(inviteModule.getInviteTargetId(event), '3853386180')
  assert.equal(inviteModule.isInviteForCurrentBot(event), false)
  assert.equal(inviteModule.isInviteForCurrentBot({
    ...event,
    invited_id: '2701177370'
  }), true)
  assert.equal(inviteModule.isInviteForCurrentBot({
    self_id: '2701177370',
    user_id: '3356510984'
  }), true)
})

test('pending requests are isolated by bot identity', () => {
  const botA = { self_id: '10001' }
  const botB = { self_id: '20002' }
  const serviceA = new inviteModule.InviteManagementService({ bot: botA })
  const serviceB = new inviteModule.InviteManagementService({ bot: botB })

  serviceA.addPendingRequest({
    requestId: '10001-request-a',
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    userId: '30003',
    nickname: '邀请人',
    flag: 'flag-a',
    subType: 'invite',
    msgIds: [],
    manageGroupIds: [],
    requestTime: Date.now(),
    status: 'pending'
  })
  serviceB.reload()

  assert.equal(serviceA.findPendingRequests({ requestId: '10001-request-a' }).length, 1)
  assert.equal(serviceB.findPendingRequests({ requestId: '10001-request-a' }).length, 0)
})

test('approved group states are isolated and consumed once', () => {
  const serviceA = new inviteModule.InviteManagementService({
    bot: { self_id: '40004' }
  })
  const serviceB = new inviteModule.InviteManagementService({
    bot: { self_id: '50005' }
  })

  serviceA.markApprovedGroup('456789')
  serviceB.reload()
  assert.equal(serviceA.isApprovedGroup('456789'), true)
  assert.equal(serviceB.isApprovedGroup('456789'), false)
  assert.equal(serviceB.consumeApprovedGroup('456789'), false)
  assert.equal(serviceA.consumeApprovedGroup('456789'), true)
  assert.equal(serviceA.isApprovedGroup('456789'), false)
})

test('manual approval of a failed precheck grants one join-time exemption', async () => {
  let approval = null
  const bot = {
    self_id: '60006',
    async sendApi(action, params) {
      assert.equal(action, 'set_group_add_request')
      approval = params
      return { data: { ok: true } }
    }
  }
  const service = new inviteModule.InviteManagementService({ bot })
  await service.approvePendingRequest({
    groupId: '654321',
    flag: 'low-member-invite',
    subType: 'invite',
    precheckStatus: 'failed'
  }, true)

  assert.equal(approval.approve, true)
  assert.equal(service.isApprovedGroup('654321'), true)
  assert.equal(service.consumeApprovedGroup('654321'), true)
  assert.equal(service.isApprovedGroup('654321'), false)
})

test('bulk blacklist deduplicates IDs and reports existing entries', () => {
  const first = yunzaiConfig.addUsersToBlacklist(['60006', '60006', '70007'], '测试')
  assert.equal(first.ok, true)
  assert.deepEqual(first.added, [60006, 70007])

  const second = yunzaiConfig.addUsersToBlacklist(['60006', '80008'], '测试')
  assert.equal(second.ok, true)
  assert.deepEqual(second.added, [80008])
  assert.deepEqual(second.existing, [60006])
})

test('extracts multiple mentioned users', () => {
  const ids = groupAdminUtils.extractAtIds({
    message: [
      { type: 'at', qq: '90009' },
      { type: 'at', qq: '80008' }
    ]
  })
  assert.deepEqual(ids, [90009, 80008])
})

test('extracts users from quoted messages and CQ at text', async () => {
  const quotedIds = await groupAdminUtils.getQuotedAtIds({
    async getReply() {
      return {
        message: [
          { type: 'at', data: { qq: '90009' } },
          { type: 'at', data: { qq: '80008' } }
        ]
      }
    }
  })
  assert.deepEqual(quotedIds, [90009, 80008])
  assert.deepEqual(groupAdminUtils.extractAtIds({ raw_message: '[CQ:at,qq=70007]' }), [70007])
})

test('formats group request notices with labels and resolves applicant nickname', async () => {
  const runtimeConfigPath = path.join(tempRoot, 'data', '自动退群', 'config', 'config.json')
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true })
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({
    groupAdmin: {
      enabled: true,
      noticeEnabled: true,
      groupAddNotice: {
        openGroup: [123456],
        msg: '收到加群申请'
      }
    }
  }, null, 2))

  globalThis.segment = {
    image(file) {
      return { type: 'image', data: { file } }
    }
  }

  let sentMessage = null
  const bot = {
    self_id: '10001',
    async sendApi(action) {
      assert.equal(action, 'get_stranger_info')
      return { data: { user_id: 99999, nickname: '申请人昵称' } }
    },
    pickGroup() {
      return {
        async sendMsg(message) {
          sentMessage = message
        }
      }
    }
  }

  const runtime = await import(
    `${pathToFileURL(path.join(testRoot, 'model/groupAdminRuntime.js')).href}?notice-test=${Date.now()}`
  )
  await runtime.handleGroupRequestForAdmin({
    bot,
    self_id: '10001',
    request_type: 'group',
    sub_type: 'add',
    group_id: 123456,
    user_id: 99999,
    comment: '哈哈哈哈我来了'
  })

  const text = sentMessage.filter(item => typeof item === 'string').join('')
  assert.match(text, /【加群申请通知】/)
  assert.match(text, /申请类型：申请入群/)
  assert.match(text, /申请人：申请人昵称/)
  assert.match(text, /QQ号：99999/)
  assert.match(text, /申请消息：哈哈哈哈我来了/)
  assert.equal(sentMessage.some(item => item?.type === 'image'), true)
})

test('approves quoted group requests and consumes skip-verification state once', async () => {
  const runtimeConfigPath = path.join(tempRoot, 'data', '自动退群', 'config', 'config.json')
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true })
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({
    groupAdmin: {
      enabled: true,
      verifyEnabled: true,
      noticeEnabled: true,
      groupVerify: {
        openGroup: [123456]
      },
      groupAddNotice: {
        openGroup: [123456],
        skipVerifyGroups: [123456],
        msg: '收到加群申请'
      }
    }
  }, null, 2))

  let requestParams = null
  const group = {
    is_admin: true,
    is_owner: false,
    async sendMsg() {
      return { message_id: 7001 }
    }
  }
  const bot = {
    self_id: '10001',
    pickGroup() {
      return group
    },
    async sendApi(action, params) {
      if (action === 'get_stranger_info') {
        return { data: { user_id: 99999, nickname: '待审批用户' } }
      }
      if (action === 'set_group_add_request') {
        requestParams = params
        return { data: { ok: true } }
      }
      throw new Error(`unexpected api: ${action}`)
    }
  }

  const runtime = await import(
    `${pathToFileURL(path.join(testRoot, 'model/groupAdminRuntime.js')).href}?approval-test=${Date.now()}`
  )
  await runtime.handleGroupRequestForAdmin({
    bot,
    self_id: '10001',
    request_type: 'group',
    sub_type: 'add',
    group_id: 123456,
    user_id: 99999,
    flag: 'request-flag-1',
    comment: '请批准我入群'
  })

  const result = await runtime.handleGroupRequestAction({
    bot,
    self_id: '10001',
    group_id: 123456,
    user_id: 55555,
    member: { role: 'admin' }
  }, { message_id: 7001 }, true)

  assert.equal(result.ok, true)
  assert.match(result.message, /跳过验证/)
  assert.equal(requestParams.flag, 'request-flag-1')
  assert.equal(requestParams.sub_type, 'add')
  assert.equal(requestParams.approve, true)

  const increaseEvent = {
    bot,
    self_id: '10001',
    group_id: 123456,
    user_id: 99999
  }
  assert.equal(await runtime.handleGroupIncreaseForAdmin(increaseEvent), true)
  assert.equal(runtime.consumeApprovedGroupRequest(increaseEvent), null)

  const repeated = await runtime.handleGroupRequestAction({
    bot,
    self_id: '10001',
    group_id: 123456,
    user_id: 55555,
    member: { role: 'admin' }
  }, { message_id: 7001 }, true)
  assert.equal(repeated.ok, false)
})

test('does not treat CQ at user IDs as mute duration', () => {
  const parsed = groupAdminUtils.parseMuteCommand({
    raw_message: 't禁言 [CQ:at,qq=4019146645] 5分钟',
    message: [
      { type: 'text', text: 't禁言 ' },
      { type: 'at', qq: '4019146645' },
      { type: 'text', text: ' 5分钟' }
    ]
  })
  assert.equal(String(parsed.target), '4019146645')
  assert.equal(parsed.time, 5)
  assert.equal(parsed.unit, '分钟')
})

test('group verification runtime registers listeners and accepts a correct answer', async () => {
  const runtimeConfigPath = path.join(tempRoot, 'data', '自动退群', 'config', 'config.json')
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true })
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({
    groupAdmin: {
      enabled: true,
      verifyEnabled: true,
      scheduledMuteEnabled: false,
      groupVerify: {
        openGroup: [123456],
        successMsgs: { 0: '验证成功' },
        mode: '精确',
        times: 3,
        remindAtLastMinute: false,
        time: 30,
        range: { min: 10, max: 11 },
        delayTime: 0
      }
    }
  }, null, 2))

  const bot = new EventEmitter()
  bot.uin = '10001'
  const group = {
    is_admin: true,
    is_owner: false,
    pickMember() {
      return null
    }
  }
  bot.pickGroup = () => group
  globalThis.segment = {
    at(userId) {
      return { type: 'at', qq: userId }
    }
  }

  const runtime = await import(
    `${pathToFileURL(path.join(testRoot, 'model/groupAdminRuntime.js')).href}?test=${Date.now()}`
  )
  globalThis.Bot = {}
  assert.equal(runtime.initGroupAdminRuntime(), false)
  globalThis.Bot = bot
  assert.equal(runtime.initGroupAdminRuntime(), true)
  assert.equal(bot.listenerCount('notice.group.increase'), 1)
  assert.equal(bot.listenerCount('message.group'), 1)

  const replies = []
  const event = {
    bot,
    self_id: '10001',
    group,
    group_id: 123456,
    user_id: 99999,
    reply: async message => {
      replies.push(message)
      return true
    }
  }

  await runtime.handleGroupIncreaseForAdmin(event)
  assert.equal(runtime.hasVerifySession(123456, 99999), true)

  const prompt = String(replies[0]?.[1] || '')
  const match = prompt.match(/「(\d+) ([+-]) (\d+)」/)
  assert.ok(match, `verification prompt missing: ${prompt}`)
  const expected = match[2] === '+'
    ? Number(match[1]) + Number(match[3])
    : Number(match[1]) - Number(match[3])

  await runtime.handleVerifyAnswer({
    ...event,
    raw_message: String(expected),
    msg: String(expected),
    message_id: 100
  })
  assert.equal(runtime.hasVerifySession(123456, 99999), false)
  assert.ok(replies.some(message => message === '验证成功'))

  fs.writeFileSync(runtimeConfigPath, JSON.stringify({
    groupAdmin: {
      enabled: false,
      verifyEnabled: true,
      scheduledMuteEnabled: false,
      groupVerify: {
        openGroup: [123456],
        successMsgs: { 0: '验证成功' },
        mode: '精确',
        times: 3,
        remindAtLastMinute: false,
        time: 30,
        range: { min: 10, max: 11 },
        delayTime: 0
      }
    }
  }, null, 2))
  await runtime.handleGroupIncreaseForAdmin({
    ...event,
    user_id: 88888
  })
  assert.equal(runtime.hasVerifySession(123456, 88888), false)
})
