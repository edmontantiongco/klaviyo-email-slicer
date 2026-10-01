import { useWorkspace, type EmailJob } from '@/store/workspace'

export function useActiveJob(): EmailJob | undefined {
  return useWorkspace((s) => s.jobs.find((j) => j.id === s.activeId))
}
