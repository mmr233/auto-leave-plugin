import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-verify-test-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
globalThis.segment = { at: userId => ({ type: 'at', qq: userId }) }

const { Config } = await import('../components/config.js')
const runtime = await import('../model/groupAdminRuntime.js')
const failures = await import('../model/verifyFailures.js')

const config = Config.loadConfig()
config.groupAdmin.enabled = true
config.groupAdmin.verifyEnabled = true
config.groupAdmin.groupVerify = {
  openGroup: [123456],
  autoBlacklistOnFailure: true,
  failedJoinLimit: 3,
  mode: '精确',
  times: 1,
  time: 30,
  range: { min: 10, max: 11 },
  remindAtLastMinute: false,
  delayTime: 0,
  successMsgs: { 0: '验证通过' }
}
Config.saveConfig(config)

const replies = []
let kicks = 0
let rejected = null
const bot = {
  uin: '10001',
  pickGroup() {
    return { is_admin: true, pickMember: () => null }
  },
  async sendApi(action, params) {
    if (action === 'set_group_kick') {
      kicks++
      return { data: { ok: true } }
    }
    if (action === 'set_group_add_request') {
      rejected = params
      return { data: { ok: true } }
    }
    throw new Error(`unexpected action: ${action}`)
  }
}
globalThis.Bot = bot
const event = {
  bot,
  self_id: '10001',
  group_id: 123456,
  user_id: 88888,
  reply: async message => {
    replies.push(message)
    return true
  }
}

async function failAdmission() {
  assert.equal(await runtime.startVerifyForUser(event, event.user_id, event.group_id, true), true)
  assert.equal(await runtime.handleVerifyAnswer({ ...event, raw_message: 't其他命令' }), false)
  assert.equal(await runtime.handleVerifyAnswer({ ...event, raw_message: '99999' }), true)
}

test('only consecutively failed admissions count; a correct answer resets the streak', async () => {
  await failAdmission()
  assert.equal(failures.isVerificationBlocked('10001', 123456, 88888), false)
  assert.equal(Config.loadList('verifyFailures.json')[0].count, 1)
  assert.equal(await runtime.startVerifyForUser(event, event.user_id, event.group_id, true), true)
  const prompt = String(replies.at(-1)?.[1] || '')
  const [, first, operator, second] = prompt.match(/「(\d+) ([+-]) (\d+)」/)
  const answer = operator === '+' ? Number(first) + Number(second) : Number(first) - Number(second)
  await runtime.handleVerifyAnswer({ ...event, raw_message: String(answer) })
  assert.deepEqual(Config.loadList('verifyFailures.json'), [])

  await failAdmission()
  await failAdmission()
  assert.equal(failures.isVerificationBlocked('10001', 123456, 88888), false)
  await failAdmission()
  assert.equal(failures.isVerificationBlocked('10001', 123456, 88888), true)
  assert.equal(failures.isVerificationBlocked('20002', 123456, 88888), false)
  assert.equal(failures.isVerificationBlocked('10001', 654321, 88888), false)
  assert.equal(kicks, 4)
})

test('blocked user is kicked on reentry, rejected at request stage, and can be unblocked', async () => {
  assert.equal(await runtime.handleGroupIncreaseForAdmin(event), true)
  assert.equal(kicks, 5)
  assert.equal(runtime.hasVerifySession(123456, 88888), false)
  await runtime.handleGroupRequestForAdmin({
    ...event,
    request_type: 'group',
    sub_type: 'add',
    flag: 'blocked-user'
  })
  assert.equal(rejected.approve, false)
  assert.equal(failures.clearVerificationFailures('10001', 123456, 88888), true)
  assert.equal(failures.isVerificationBlocked('10001', 123456, 88888), false)
})

test('manually restarted verification is not another failed admission', async () => {
  assert.equal(await runtime.startVerifyForUser(event, event.user_id), true)
  assert.equal(await runtime.handleVerifyAnswer({ ...event, raw_message: '99999' }), true)
  assert.deepEqual(Config.loadList('verifyFailures.json'), [])
})

test('a timed-out verification does not count as a failed admission', async () => {
  failures.recordFailedVerification('10001', 123456, 99999, 3)
  const next = Config.loadConfig()
  next.groupAdmin.groupVerify.time = 0.01
  Config.saveConfig(next)
  assert.equal(await runtime.startVerifyForUser({ ...event, user_id: 99999 }, 99999), true)
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(runtime.hasVerifySession(123456, 99999), false)
  assert.deepEqual(Config.loadList('verifyFailures.json'), [])
})
