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
})
