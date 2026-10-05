// 安置沙盘的本地持久化：周计划与场地核验通知跟条目数据分开存放，互不影响重置。
const STORAGE_KEY = 'geohazard-monitor-prevention:sandbox'

export type PlanStatus = '草稿' | '已确认'

export type WeeklyPlan = {
  id: number
  计划编号: string
  计划周: string
  所在乡镇: string
  户Ids: number[]
  status: PlanStatus
  创建时间: string
  确认时间: string
}

export type NoticeStatus = '待核验' | '已核验'

export type SiteNotice = {
  id: number
  通知编号: string
  计划编号: string
  户号: string
  户主姓名: string
  所属隐患点: string
  所在乡镇: string
  安置方式: string
  安置地点: string
  生成时间: string
  status: NoticeStatus
}

export type SandboxData = {
  plans: WeeklyPlan[]
  notices: SiteNotice[]
}

let cache: SandboxData | null = null

export function loadSandbox(): SandboxData {
  if (cache !== null) {
    return cache
  }
  const fallback: SandboxData = { plans: [], notices: [] }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = fallback
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = fallback
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SandboxData>
    cache = { plans: parsed.plans ?? [], notices: parsed.notices ?? [] }
  } catch {
    cache = fallback
  }
  return cache
}

export function saveSandbox(data: SandboxData): void {
  cache = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}
