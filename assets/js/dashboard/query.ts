import {
  nowForSite,
  formatISO,
  shiftDays,
  shiftMonths,
  isBefore,
  parseUTCDate,
  isAfter
} from './util/date'
import { FILTER_OPERATIONS, getFiltersByKeyPrefix } from './util/filters'
import { PlausibleSite } from './site-context'
import { ComparisonMode, QueryPeriod } from './query-time-periods'
import { AppNavigationTarget } from './navigation/use-app-navigate'
import { Dayjs } from 'dayjs'

export type FilterClause = string | number

export type FilterOperator = string

export type FilterKey = string

export type Filter = [FilterOperator, FilterKey, FilterClause[]]

/**
 * Dictionary that holds a human readable value for ID-based filter clauses.
 * Needed to show the human readable value in the Filters configuration screens.
 * Does not go through the backend.
 * For example,
 *  for filters `[["is", "city", [2761369]], ["is", "country", ["AT"]]]`,
 *  labels would be `{"2761369": "Vienna", "AT": "Austria"}`
 * */
export type FilterClauseLabels = Record<string, string>

export type DashboardQuery = {
  period: QueryPeriod
  comparison: ComparisonMode | null
  match_day_of_week: boolean
  date: Dayjs | null
  from: Dayjs | null
  to: Dayjs | null
  compare_from: Dayjs | null
  compare_to: Dayjs | null
  filters: Filter[]
  /**
   * This property is the same as `filters` always, except when
   * `filters` contains a "Segment is {segment ID}" filter. In this case,
   * `resolvedFilters` has the segment filter replaced with its constituent filters,
   * so the FE could be aware of what filters are applied.
   */
  resolvedFilters: Filter[]
  labels: FilterClauseLabels
  with_imported: boolean
}

export const queryDefaultValue: DashboardQuery = {
  period: '28d' as QueryPeriod,
  comparison: null,
  match_day_of_week: true,
  date: null,
  from: null,
  to: null,
  compare_from: null,
  compare_to: null,
  filters: [],
  resolvedFilters: [],
  labels: {},
  with_imported: true
}

export type BreakdownResultMeta = {
  date_range_label: string
  comparison_date_range_label?: string
  metric_warnings: Record<string, Record<string, string>> | undefined
}

export function addFilter(
  query: DashboardQuery,
  filter: Filter
): DashboardQuery {
  return { ...query, filters: [...query.filters, filter] }
}

export function postProcessFilters(filters: Array<Filter>): Array<Filter> {
  return filters.map(([operation, dimension, clauses]) => {
    // Rename old name of the operation
    if (operation === 'does_not_contain') {
      operation = FILTER_OPERATIONS.contains_not
    }
    return [operation, dimension, clauses]
  })
}

// Returns a boolean indicating whether the given query includes a
// non-empty goal filterset containing a single, or multiple revenue
// goals with the same currency. Used to decide whether to render
// revenue metrics in a dashboard report or not.
export function revenueAvailable(query: DashboardQuery, site: PlausibleSite) {
  const revenueGoalsInFilter = site.revenueGoals.filter((revenueGoal) => {
    const goalFilters: Filter[] = getFiltersByKeyPrefix(query, 'goal')

    return goalFilters.some(([operation, _key, clauses]) => {
      return (
        [FILTER_OPERATIONS.is, FILTER_OPERATIONS.contains].includes(
          operation
        ) && clauses.includes(revenueGoal.display_name)
      )
    })
  })

  const singleCurrency = revenueGoalsInFilter.every((rg) => {
    return rg.currency === revenueGoalsInFilter[0].currency
  })

  return revenueGoalsInFilter.length > 0 && singleCurrency
}

export const clearedDateSearch = {
  period: null,
  from: null,
  to: null,
  date: null,
  keybindHint: null
}

export const clearedComparisonSearch = {
  comparison: null,
  compare_from: null,
  compare_to: null
}

export function isDateOnOrAfterStatsStartDate({
  site,
  date,
  period
}: {
  site: PlausibleSite
  date: string
  period: QueryPeriod
}) {
  return !isBefore(parseUTCDate(date), parseUTCDate(site.statsBegin), period)
}

export function isDateBeforeOrOnCurrentDate({
  site,
  date,
  period
}: {
  site: PlausibleSite
  date: string
  period: QueryPeriod
}) {
  const currentDate = nowForSite(site)
  return !isAfter(parseUTCDate(date), currentDate, period)
}

export function getDateForShiftedPeriod({
  site,
  query,
  direction
}: {
  site: PlausibleSite
  direction: -1 | 1
  query: DashboardQuery
}) {
  const isWithinRangeByDirection = {
    '-1': isDateOnOrAfterStatsStartDate,
    '1': isDateBeforeOrOnCurrentDate
  }
  const shiftByPeriod = {
    [QueryPeriod.day]: { shift: shiftDays, amount: 1 },
    [QueryPeriod.month]: { shift: shiftMonths, amount: 1 },
    [QueryPeriod.year]: { shift: shiftMonths, amount: 12 }
  } as const

  const { shift, amount } =
    shiftByPeriod[query.period as keyof typeof shiftByPeriod] ?? {}
  if (shift) {
    const date = shift(query.date, direction * amount)
    if (
      isWithinRangeByDirection[direction]({ site, date, period: query.period })
    ) {
      return date
    }
  }
  return null
}

function setQueryPeriodAndDate({
  period,
  date = null,
  keybindHint = null
}: {
  period: QueryPeriod
  date?: null | string
  keybindHint?: null | string
}): AppNavigationTarget['search'] {
  return function (search) {
    return {
      ...search,
      ...clearedDateSearch,
      period,
      date,
      keybindHint
    }
  }
}

export function shiftQueryPeriod({
  site,
  query,
  direction,
  keybindHint
}: {
  site: PlausibleSite
  query: DashboardQuery
  direction: -1 | 1
  keybindHint?: null | string
}): AppNavigationTarget['search'] {
  const date = getDateForShiftedPeriod({ site, query, direction })
  if (date !== null) {
    return setQueryPeriodAndDate({
      period: query.period,
      date: formatISO(date),
      keybindHint
    })
  }
  return (search) => search
}
