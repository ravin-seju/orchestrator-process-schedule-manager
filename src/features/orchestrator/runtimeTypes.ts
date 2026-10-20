// Orchestrator runtime types (JobDto.RuntimeType, MachineRuntimeDto.Type) and which of them the
// Utilization view counts. Capacity and consumed hours use the same set, so the percentage
// compares like with like.
//
// Counted: robots that run unattended work, in production or test environments.
// Not counted: development and personal runtimes (Studio, Assistant, Attended, Development, ...),
// agentic and platform services (AgentService, ProcessOrchestration, Flow, ...), and Headless /
// Hosting, whose meaning UiPath's current docs don't pin down. Uncounted types still appear in the
// By runtime type table.
export const COUNTED_RUNTIME_TYPES: ReadonlySet<string> = new Set([
  'Unattended',
  'AutomationCloud',
  'Serverless',
  'NonProduction',
  'TestAutomation',
  'AutomationCloudTestAutomation',
  'ServerlessTestAutomation',
  'AppTest',
  'PerformanceTest',
])

const RUNTIME_TYPE_LABELS: Record<string, string> = {
  Unattended: 'Unattended (Production)',
  AutomationCloud: 'Cloud VM',
  Serverless: 'Cloud Serverless',
  NonProduction: 'Non-production',
  TestAutomation: 'Testing',
  AutomationCloudTestAutomation: 'Cloud VM Testing',
  ServerlessTestAutomation: 'Cloud Serverless Testing',
  AppTest: 'App Testing',
  PerformanceTest: 'Performance Testing',
  Development: 'Development',
  Attended: 'Attended',
  Headless: 'Headless',
  Hosting: 'Hosting',
  AgentService: 'Agent Service',
  ProcessOrchestration: 'Process Orchestration',
  CaseManagement: 'Case Management',
  BusinessRule: 'Business Rule',
}

export const isCountedRuntimeType = (type: string | null | undefined): type is string =>
  type != null && COUNTED_RUNTIME_TYPES.has(type)

export const runtimeTypeLabel = (type: string | null) =>
  type == null ? 'Unknown' : (RUNTIME_TYPE_LABELS[type] ?? type)
