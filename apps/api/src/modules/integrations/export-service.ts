import type { Id } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import {
  EXPORT_COLUMNS,
  EXPORT_PII_COLUMNS,
  type ExportColumn,
  type ExportDownload,
  type ExportFilter,
  type ExportFormat,
  type ExportJobRecord,
  type ExportJobView,
  type ExportService,
} from "../exports/service";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";
import type { IntegrationService } from "./service";

export interface AgentExportInput {
  readonly format: ExportFormat;
  readonly includePii: boolean;
  readonly filter?: ExportFilter;
  readonly columns?: readonly ExportColumn[];
}

interface ScheduleExportContext {
  readonly scheduleId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly mode: "MAIN" | "PRACTICE";
}

export class AgentExportNotFoundError extends Error {
  constructor() {
    super("Export job or schedule was not found");
    this.name = "AgentExportNotFoundError";
  }
}

export class AgentExportPiiDeniedError extends Error {
  constructor() {
    super("The integration grant does not allow PII export");
    this.name = "AgentExportPiiDeniedError";
  }
}

/** Agent policy boundary around the export service shared with staff web. */
export class IntegrationExportService {
  constructor(
    private readonly options: {
      readonly database: DatabasePort;
      readonly integration: IntegrationService;
      readonly exports: ExportService;
    },
  ) {}

  async createExport(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    input: AgentExportInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<ExportJobView> {
    this.options.integration.checkExportRateLimit(authentication.client.id);
    const access = await this.authorizeSchedule(
      authentication,
      scheduleId,
      requestId,
    );
    if (input.includePii && !allowsPii(access.grant))
      throw new AgentExportPiiDeniedError();
    if (
      input.columns?.some((column) => EXPORT_PII_COLUMNS.has(column)) &&
      !allowsPii(access.grant)
    )
      throw new AgentExportPiiDeniedError();
    const rowLimit = maxExportRows(access.grant);
    const job = await this.options.exports.createAgentJob({
      requesterUserId: authentication.client.ownerUserId,
      integrationClientId: authentication.client.id,
      integrationGrantVersion: access.grant.grantVersion,
      scopeSnapshot: {
        ownerUserId: access.schedule.ownerTeacherId,
        subjectId: access.schedule.subjectId,
        scheduleId: access.schedule.scheduleId,
        mode: access.schedule.mode,
      },
      scheduleId,
      format: input.format,
      includePii: input.includePii,
      rowLimit,
      idempotencyKey,
      ...(input.filter ? { filter: input.filter } : {}),
      ...(input.columns ? { columns: input.columns } : {}),
    });
    await this.audit(
      authentication,
      access.schedule,
      requestId,
      "INTEGRATION_EXPORT_CREATE",
      { format: input.format, includePii: input.includePii, rowLimit },
    );
    return job;
  }

  async getStatus(
    authentication: IntegrationAuthentication,
    jobId: Id,
    requestId: string,
  ): Promise<ExportJobView> {
    const { record } = await this.requireAuthorizedJob(
      authentication,
      jobId,
      requestId,
    );
    return {
      id: record.id,
      scheduleId: record.scheduleId,
      format: record.format,
      status: record.status,
      includePii: record.includePii,
      rowCount: record.rowCount,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
  }

  async issueDownloadToken(
    authentication: IntegrationAuthentication,
    jobId: Id,
    requestId: string,
  ): Promise<{
    readonly token: string;
    readonly expiresAt: string;
    readonly downloadPath: string;
  }> {
    const { record, schedule } = await this.requireAuthorizedJob(
      authentication,
      jobId,
      requestId,
    );
    const token = await this.options.exports.issueDownloadToken(record.id);
    await this.audit(
      authentication,
      schedule,
      requestId,
      "INTEGRATION_EXPORT_TOKEN_ISSUE",
      { jobId: record.id },
    );
    return {
      ...token,
      downloadPath: `/api/v1/integrations/agent/exports/${record.id}/download`,
    };
  }

  async download(
    authentication: IntegrationAuthentication,
    jobId: Id,
    token: string,
    requestId: string,
  ): Promise<ExportDownload> {
    const { record, schedule } = await this.requireAuthorizedJob(
      authentication,
      jobId,
      requestId,
    );
    const result = await this.options.exports.consumeDownload(record.id, token);
    await this.audit(
      authentication,
      schedule,
      requestId,
      "INTEGRATION_EXPORT_DOWNLOAD",
      { jobId: record.id },
    );
    return result;
  }

  private async requireAuthorizedJob(
    authentication: IntegrationAuthentication,
    jobId: Id,
    requestId: string,
  ): Promise<{
    readonly record: ExportJobRecord;
    readonly grant: IntegrationGrant;
    readonly schedule: ScheduleExportContext;
  }> {
    const record = await this.options.exports.getJob(jobId);
    if (!record || record.integrationClientId !== authentication.client.id)
      throw new AgentExportNotFoundError();
    const access = await this.authorizeSchedule(
      authentication,
      record.scheduleId,
      requestId,
    );
    if (
      record.integrationGrantVersion !== null &&
      access.grant.grantVersion !== record.integrationGrantVersion
    )
      throw new AgentExportNotFoundError();
    return { record, ...access };
  }

  private async authorizeSchedule(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    requestId: string,
  ): Promise<{
    readonly grant: IntegrationGrant;
    readonly schedule: ScheduleExportContext;
  }> {
    const schedule = await this.findSchedule(scheduleId);
    if (!schedule) throw new AgentExportNotFoundError();
    const grant = await this.options.integration.assertCapability(
      authentication,
      "results.export",
      requestId,
    );
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: schedule.ownerTeacherId,
      subjectId: schedule.subjectId,
      resourceId: schedule.scheduleId,
    });
    return { grant, schedule };
  }

  private async findSchedule(
    scheduleId: Id,
  ): Promise<ScheduleExportContext | null> {
    const rows = await this.options.database.query<Record<string, unknown>>(
      `SELECT es.id AS schedule_id, es.mode, e.subject_id, e.owner_teacher_id
       FROM exam_schedules es
       JOIN exam_revisions er ON er.id = es.exam_revision_id
       JOIN exams e ON e.id = er.exam_id
       WHERE es.id = ? LIMIT 1`,
      [scheduleId],
    );
    const row = rows[0];
    if (!row || (row.mode !== "MAIN" && row.mode !== "PRACTICE")) return null;
    return {
      scheduleId: String(row.schedule_id) as Id,
      subjectId: String(row.subject_id) as Id,
      ownerTeacherId: String(row.owner_teacher_id) as Id,
      mode: row.mode,
    };
  }

  private async audit(
    authentication: IntegrationAuthentication,
    schedule: ScheduleExportContext,
    requestId: string,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "export_job",
      entityId: schedule.scheduleId,
      requestId,
      outcome: "SUCCESS",
      metadata: { mode: schedule.mode, ...metadata },
    });
  }
}

function allowsPii(grant: IntegrationGrant): boolean {
  return grant.constraints.result_pii_export_allowed === true;
}

function maxExportRows(grant: IntegrationGrant): number {
  const value = grant.constraints.max_export_rows;
  if (value === undefined) return 10_000;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 100_000)
    : 10_000;
}

/** Kept exported so adapters can validate columns without duplicating strings. */
export { EXPORT_COLUMNS };
