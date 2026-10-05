import { listRows, saveRows } from '@/data/local-store'
import { loadSandbox, saveSandbox } from '@/data/sandbox'
import type { SiteNotice, WeeklyPlan } from '@/data/sandbox'
import type { EntryRow } from '@/data/types'

// 安置沙盘的业务规则都收在这里，页面只负责渲染和转发操作。
//
// 归属规则（同一户被多个计划同时纳入时）：
//   1. 已确认计划优先锁定：户一旦进入已确认计划，其它计划一律不能再纳入；
//   2. 草稿之间后纳入者得：拖进新草稿时自动从旧草稿移出，页面会提示来源计划；
//   3. 确认计划时再做一次兜底清理，把本计划的户从其它草稿中锁定移出。
// 重复确认：同一周且户名单完全相同的确认计划只保留一版，重复确认的草稿直接回收。
// 待补录：缺安置地点的户可以先进草稿，但计划确认前必须补录完成。

export const BOARD_STATUSES = ['待动员', '已签约', '已搬迁', '已安置', '拒绝搬迁'] as const

const DAY_MS = 24 * 60 * 60 * 1000

type Result = { ok: boolean; message: string }

export type OwnershipConfirm = {
  planId: number
  householdId: number
  householdTownship: string
  planTownship: string
}

export type AddResult = Result & { needOwnershipConfirm?: OwnershipConfirm }

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function mondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function isoWeek(date: Date): string {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7))
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
}

export function currentWeek(): string {
  return isoWeek(new Date())
}

export function weekOptions(count = 8): { value: string; label: string }[] {
  const monday = mondayOfWeek(new Date())
  const options: { value: string; label: string }[] = []
  for (let i = 0; i < count; i += 1) {
    const start = new Date(monday)
    start.setDate(start.getDate() + i * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const value = isoWeek(start)
    const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
    options.push({ value, label: `${value}（${fmt(start)} ~ ${fmt(end)}）` })
  }
  return options
}

export function remainingDays(row: EntryRow, today: Date = new Date()): number | null {
  const raw = String(row['搬迁期限'] ?? '').trim()
  if (!raw) {
    return null
  }
  const target = Date.parse(`${raw}T00:00:00`)
  if (Number.isNaN(target)) {
    return null
  }
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return Math.round((target - start) / DAY_MS)
}

export function isMissingLocation(row: EntryRow): boolean {
  return String(row['安置地点'] ?? '').trim() === ''
}

export function listPlans(): WeeklyPlan[] {
  return loadSandbox().plans
}

export function listNotices(): SiteNotice[] {
  return loadSandbox().notices
}

export function createPlan(week: string): Result & { plan?: WeeklyPlan } {
  if (!week) {
    return { ok: false, message: '先选一个计划周' }
  }
  const data = loadSandbox()
  const seq = data.plans.filter((plan) => plan.计划周 === week).length + 1
  const plan: WeeklyPlan = {
    id: nextId(data.plans),
    计划编号: `ZP-${week.replace('-', '')}-${String(seq).padStart(2, '0')}`,
    计划周: week,
    所在乡镇: '',
    户Ids: [],
    status: '草稿',
    创建时间: now(),
    确认时间: '',
  }
  data.plans = [...data.plans, plan]
  saveSandbox(data)
  return { ok: true, message: `已创建${week}周计划 ${plan.计划编号}，把户卡拖进计划区即可`, plan }
}

export function deletePlan(planId: number): Result {
  const data = loadSandbox()
  const plan = data.plans.find((item) => item.id === planId)
  if (!plan) {
    return { ok: false, message: '没有找到这个周计划' }
  }
  if (plan.status !== '草稿') {
    return { ok: false, message: `计划 ${plan.计划编号} 已确认，不能删除` }
  }
  data.plans = data.plans.filter((item) => item.id !== planId)
  saveSandbox(data)
  return { ok: true, message: `草稿计划 ${plan.计划编号} 已删除` }
}

export function addHouseholdToPlan(planId: number, householdId: number, ownershipConfirmed = false): AddResult {
  const data = loadSandbox()
  const plan = data.plans.find((item) => item.id === planId)
  if (!plan) {
    return { ok: false, message: '没有找到这个周计划' }
  }
  if (plan.status !== '草稿') {
    return { ok: false, message: `计划 ${plan.计划编号} 已确认，不能再调整` }
  }
  const household = listRows('evacuation').find((row) => Number(row.id) === householdId)
  if (!household) {
    return { ok: false, message: '没有找到这户搬迁安置户' }
  }
  const label = `${household['户号']}（${household['户主姓名']}）`
  if (plan.户Ids.includes(householdId)) {
    return { ok: false, message: `${label} 已在本计划里` }
  }
  const lockedIn = data.plans.find((item) => item.status === '已确认' && item.户Ids.includes(householdId))
  if (lockedIn) {
    return { ok: false, message: `${label} 已纳入已确认计划 ${lockedIn.计划编号}，归属该计划，不能重复纳入` }
  }
  const householdTownship = String(household['所在乡镇'] ?? '')
  if (plan.所在乡镇 && householdTownship && householdTownship !== plan.所在乡镇 && !ownershipConfirmed) {
    return {
      ok: false,
      message: '跨乡镇安置需权属确认',
      needOwnershipConfirm: { planId, householdId, householdTownship, planTownship: plan.所在乡镇 },
    }
  }
  const movedOut: string[] = []
  for (const other of data.plans) {
    if (other.id !== plan.id && other.status === '草稿' && other.户Ids.includes(householdId)) {
      other.户Ids = other.户Ids.filter((id) => id !== householdId)
      movedOut.push(other.计划编号)
    }
  }
  if (!plan.所在乡镇) {
    plan.所在乡镇 = householdTownship
  }
  plan.户Ids = [...plan.户Ids, householdId]
  saveSandbox(data)
  const crossNote = householdTownship && householdTownship !== plan.所在乡镇 ? '（跨乡镇权属已确认）' : ''
  const moveNote = movedOut.length ? `，按归属规则已从计划 ${movedOut.join('、')} 移出` : ''
  return { ok: true, message: `${label} 已纳入计划 ${plan.计划编号}${crossNote}${moveNote}` }
}

export function removeHouseholdFromPlan(planId: number, householdId: number): Result {
  const data = loadSandbox()
  const plan = data.plans.find((item) => item.id === planId)
  if (!plan) {
    return { ok: false, message: '没有找到这个周计划' }
  }
  if (plan.status !== '草稿') {
    return { ok: false, message: `计划 ${plan.计划编号} 已确认，不能调整` }
  }
  plan.户Ids = plan.户Ids.filter((id) => id !== householdId)
  saveSandbox(data)
  return { ok: true, message: `已把该户移出计划 ${plan.计划编号}` }
}

function memberSignature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',')
}

export function confirmPlan(planId: number): Result {
  const data = loadSandbox()
  const plan = data.plans.find((item) => item.id === planId)
  if (!plan) {
    return { ok: false, message: '没有找到这个周计划' }
  }
  if (plan.status === '已确认') {
    return { ok: false, message: `计划 ${plan.计划编号} 已确认过，系统只保留一版` }
  }
  if (plan.户Ids.length === 0) {
    return { ok: false, message: '计划里还没有户，先把户卡拖进来' }
  }
  const households = listRows('evacuation')
  const members = plan.户Ids
    .map((id) => households.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  const missing = members.filter(isMissingLocation)
  if (missing.length > 0) {
    return {
      ok: false,
      message: `以下 ${missing.length} 户缺安置地点，请先在「待补录」区补录：${missing.map((row) => row['户号']).join('、')}`,
    }
  }
  const duplicate = data.plans.find(
    (item) =>
      item.status === '已确认' &&
      item.计划周 === plan.计划周 &&
      memberSignature(item.户Ids) === memberSignature(plan.户Ids),
  )
  if (duplicate) {
    data.plans = data.plans.filter((item) => item.id !== plan.id)
    saveSandbox(data)
    return { ok: true, message: `该周已存在户名单相同的确认计划 ${duplicate.计划编号}，重复确认只保留一版，本草稿已回收` }
  }
  plan.status = '已确认'
  plan.确认时间 = now()
  const detached: string[] = []
  for (const other of data.plans) {
    if (other.id !== plan.id && other.status === '草稿') {
      const before = other.户Ids.length
      other.户Ids = other.户Ids.filter((id) => !plan.户Ids.includes(id))
      if (other.户Ids.length !== before) {
        detached.push(other.计划编号)
      }
    }
  }
  const existingKeys = new Set(data.notices.map((notice) => `${notice.计划编号}#${notice.户号}`))
  let created = 0
  for (const row of members) {
    const key = `${plan.计划编号}#${row['户号']}`
    if (existingKeys.has(key)) {
      continue
    }
    created += 1
    const notice: SiteNotice = {
      id: nextId(data.notices),
      通知编号: `CH-${plan.计划编号}-${String(created).padStart(2, '0')}`,
      计划编号: plan.计划编号,
      户号: String(row['户号'] ?? ''),
      户主姓名: String(row['户主姓名'] ?? ''),
      所属隐患点: String(row['所属隐患点'] ?? ''),
      所在乡镇: String(row['所在乡镇'] ?? ''),
      安置方式: String(row['安置方式'] ?? ''),
      安置地点: String(row['安置地点'] ?? ''),
      生成时间: now(),
      status: '待核验',
    }
    data.notices = [...data.notices, notice]
  }
  saveSandbox(data)
  const detachNote = detached.length ? `；归属锁定，已从草稿 ${detached.join('、')} 移出本计划的户` : ''
  return { ok: true, message: `计划 ${plan.计划编号} 已确认，已向治理工程页推送 ${created} 条场地核验通知${detachNote}` }
}

export function completeNotice(noticeId: number): Result {
  const data = loadSandbox()
  const notice = data.notices.find((item) => item.id === noticeId)
  if (!notice) {
    return { ok: false, message: '没有找到这条场地核验通知' }
  }
  if (notice.status === '已核验') {
    return { ok: false, message: `通知 ${notice.通知编号} 已核验过，不用重复操作` }
  }
  notice.status = '已核验'
  saveSandbox(data)
  return { ok: true, message: `通知 ${notice.通知编号} 已完成场地核验` }
}

export function supplementLocation(householdId: number, location: string): Result {
  const trimmed = location.trim()
  if (!trimmed) {
    return { ok: false, message: '安置地点不能为空' }
  }
  const rows = listRows('evacuation')
  const index = rows.findIndex((row) => Number(row.id) === householdId)
  if (index < 0) {
    return { ok: false, message: '没有找到这户搬迁安置户' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 安置地点: trimmed }
  saveRows('evacuation', next)
  return { ok: true, message: `${rows[index]['户号']} 的安置地点已补录为「${trimmed}」` }
}
