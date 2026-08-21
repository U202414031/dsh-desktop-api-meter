/**
 * DeepSeek 官方「峰谷计价」时段检测。
 *
 * 自 2026-08-17 0 时（北京时间）起，DeepSeek API 实行峰谷定价：
 * - 高峰时段：北京时间工作日（周一~周五）9:00–12:00、14:00–18:00，价格为空闲时段的 2 倍
 * - 空闲时段：其余时间（含午休、夜间、周末及法定节假日），价格为高峰的一半
 *
 * 注意：官方对法定节假日同样按空闲计价，本模块未内置节假日历，按
 * 「工作日 + 时段」估算；若恰逢法定节假日调休，以官方公告为准。
 */

/** 当前所处细分阶段。 */
export type PeakPhase = 'peak-am' | 'peak-pm' | 'noon' | 'night' | 'weekend'

/** 一次完整的时段判断结果。 */
export interface PeakInfo {
  /** 是否处于高峰时段。 */
  peak: boolean
  /** 细分阶段。 */
  phase: PeakPhase
  /** 阶段文案，如「上午高峰」「夜间空闲」。 */
  phaseLabel: string
  /** 主标题，如「DeepSeek 高峰时段」。 */
  title: string
  /** 价格说明，如「价格 ×2」「价格 ×0.5」。 */
  priceNote: string
  /** 距下一次时段切换的毫秒数。 */
  nextMs: number
  /** 距下一次时段切换的友好描述，如「距高峰结束还有 45 分钟」。 */
  nextLabel: string
}

const PEAK_AM_START = 9 * 60
const PEAK_AM_END = 12 * 60
const PEAK_PM_START = 14 * 60
const PEAK_PM_END = 18 * 60

/** 把「分钟」换算成当日毫秒时间戳（用于计算当天内的切换点）。 */
function minutesToMs(now: Date, minutes: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + minutes * 60_000
}

/** 自 `from` 起下一个「工作日 9:00」的毫秒时间戳（用于跨天/跨周末切换）。 */
function nextWorkdayNine(from: Date): number {
  const d = new Date(from)
  for (let i = 0; i < 8; i += 1) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) {
      d.setHours(9, 0, 0, 0)
      if (d.getTime() > from.getTime()) return d.getTime()
    }
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  }
  // 防御：8 天内必有一个工作日，此处不应到达。
  return d.getTime()
}

/** 把毫秒差格式化为「X 天 X 小时」「X 小时 X 分钟」「X 分钟」。 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

/** 按官方规则判断给定时刻属于高峰还是空闲，并给出距下次切换的倒计时。 */
export function getPeakInfo(now: Date): PeakInfo {
  const day = now.getDay() // 0=周日, 6=周六
  const minutes = now.getHours() * 60 + now.getMinutes()

  // 周末全天空闲。
  if (day === 0 || day === 6) {
    const next = nextWorkdayNine(now)
    return {
      peak: false,
      phase: 'weekend',
      phaseLabel: '周末空闲',
      title: 'DeepSeek 空闲时段',
      priceNote: '价格 ×0.5',
      nextMs: next - now.getTime(),
      nextLabel: `距下个高峰开始还有 ${formatDuration(next - now.getTime())}`,
    }
  }

  // 工作日 9:00–12:00：上午高峰。
  if (minutes >= PEAK_AM_START && minutes < PEAK_AM_END) {
    const target = minutesToMs(now, PEAK_AM_END)
    return {
      peak: true,
      phase: 'peak-am',
      phaseLabel: '上午高峰',
      title: 'DeepSeek 高峰时段',
      priceNote: '价格 ×2',
      nextMs: target - now.getTime(),
      nextLabel: `距高峰结束还有 ${formatDuration(target - now.getTime())}`,
    }
  }
  // 工作日 12:00–14:00：午间空闲。
  if (minutes >= PEAK_AM_END && minutes < PEAK_PM_START) {
    const target = minutesToMs(now, PEAK_PM_START)
    return {
      peak: false,
      phase: 'noon',
      phaseLabel: '午间空闲',
      title: 'DeepSeek 空闲时段',
      priceNote: '价格 ×0.5',
      nextMs: target - now.getTime(),
      nextLabel: `距下午高峰开始还有 ${formatDuration(target - now.getTime())}`,
    }
  }
  // 工作日 14:00–18:00：下午高峰。
  if (minutes >= PEAK_PM_START && minutes < PEAK_PM_END) {
    const target = minutesToMs(now, PEAK_PM_END)
    return {
      peak: true,
      phase: 'peak-pm',
      phaseLabel: '下午高峰',
      title: 'DeepSeek 高峰时段',
      priceNote: '价格 ×2',
      nextMs: target - now.getTime(),
      nextLabel: `距高峰结束还有 ${formatDuration(target - now.getTime())}`,
    }
  }

  // 工作日夜间（18:00–24:00 与 0:00–9:00）空闲，切换到下一个工作日 9:00。
  const next = nextWorkdayNine(now)
  return {
    peak: false,
    phase: 'night',
    phaseLabel: '夜间空闲',
    title: 'DeepSeek 空闲时段',
    priceNote: '价格 ×0.5',
    nextMs: next - now.getTime(),
    nextLabel: `距高峰开始还有 ${formatDuration(next - now.getTime())}`,
  }
}
