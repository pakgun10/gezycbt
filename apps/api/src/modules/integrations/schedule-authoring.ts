import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { ActorContext, UseCaseContext } from "../../application/actor-context";
import type { ScheduleAccessCodeService, RotatedScheduleAccessCode } from "../schedules/access-code";
import type {
  CreateScheduleInput,
  Schedule,
  ScheduleTransition,
  UpdateScheduleInput,
} from "../schedules/domain";
import type { ScheduleRepository } from "../schedules/repository";
import type { ScheduleService } from "../schedules/service";
import {
  type IntegrationAuthentication,
  type IntegrationGrant,
} from "./domain";
import type { IntegrationService } from "./service";

export interface AgentScheduleAuthoringOptions {
  readonly integration: IntegrationService;
  readonly schedules: ScheduleService;
  readonly accessCodes: ScheduleAccessCodeService;
  readonly repository: Pick<ScheduleRepository, "findSchedule" | "findExamRevision">;
}

export class AgentScheduleNotFoundError extends Error {
  constructor() {
    super("Schedule was not found");
    this.name = "AgentScheduleNotFoundError";
  }
}

/**
 * Schedule mutations for machine clients. The service deliberately delegates
 * lifecycle rules to the same ScheduleService and access-code service used by
 * the staff UI, so the integration cannot create a schedule with weaker rules.
 */
export class IntegrationScheduleAuthoringService {
  constructor(private readonly options: AgentScheduleAuthoringOptions) {}

  async getSchedule(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    requestId: string,
  ): Promise<Schedule> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "schedules.read",
      requestId,
    );
    const schedule = await this.options.schedules.getSchedule(
      this.context(authentication, requestId),
      scheduleId,
    );
    if (!schedule) throw new AgentScheduleNotFoundError();
    await this.assertScope(authentication, grant, schedule);
    return schedule;
  }

  async createSchedule(
    authentication: IntegrationAuthentication,
    input: CreateScheduleInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<Schedule> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "schedules.create",
      requestId,
    );
    const exam = await this.options.repository.findExamRevision(
      input.examRevisionId,
    );
    if (!exam) throw new AgentScheduleNotFoundError();
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: exam.ownerTeacherId,
      subjectId: exam.subjectId,
      resourceId: exam.examId,
    });
    const schedule = await this.options.schedules.createSchedule(
      this.context(authentication, requestId, idempotencyKey),
      input,
    );
    await this.audit(authentication, "INTEGRATION_SCHEDULE_CREATE", schedule, requestId);
    return schedule;
  }

  async updateSchedule(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    input: UpdateScheduleInput,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<Schedule> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "schedules.update",
      requestId,
    );
    const current = await this.requireScopedSchedule(
      authentication,
      grant,
      scheduleId,
      requestId,
    );
    const schedule = await this.options.schedules.updateSchedule(
      this.context(authentication, requestId, idempotencyKey),
      current.id,
      input,
      expectedUpdatedAt,
    );
    await this.audit(authentication, "INTEGRATION_SCHEDULE_UPDATE", schedule, requestId);
    return schedule;
  }

  async rotatePracticeToken(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    expectedUpdatedAt: UtcTimestamp,
    proposedCode: string | undefined,
    requestId: string,
    idempotencyKey: string,
  ): Promise<RotatedScheduleAccessCode> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "schedules.rotate_token",
      requestId,
    );
    const current = await this.requireScopedSchedule(
      authentication,
      grant,
      scheduleId,
      requestId,
    );
    const rotated = await this.options.accessCodes.rotatePracticeToken(
      this.context(authentication, requestId, idempotencyKey),
      current.id,
      expectedUpdatedAt,
      proposedCode,
    );
    await this.options.integration.recordAgentAudit({
      action: "INTEGRATION_SCHEDULE_ROTATE_TOKEN",
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "schedule",
      entityId: current.id,
      requestId,
      outcome: "SUCCESS",
      metadata: { hint: rotated.hint },
    });
    return rotated;
  }

  async transitionSchedule(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    targetStatus: Extract<ScheduleTransition, "READY" | "OPEN">,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<Schedule> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "schedules.activate",
      requestId,
    );
    const current = await this.requireScopedSchedule(
      authentication,
      grant,
      scheduleId,
      requestId,
    );
    const schedule = await this.options.schedules.transitionSchedule(
      this.context(authentication, requestId, idempotencyKey),
      current.id,
      targetStatus,
      expectedUpdatedAt,
      new Date().toISOString() as UtcTimestamp,
    );
    await this.audit(
      authentication,
      `INTEGRATION_SCHEDULE_${targetStatus}`,
      schedule,
      requestId,
    );
    return schedule;
  }

  private async requireScopedSchedule(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    scheduleId: Id,
    requestId: string,
  ): Promise<Schedule> {
    const schedule = await this.options.schedules.getSchedule(
      this.context(authentication, requestId),
      scheduleId,
    );
    if (!schedule) throw new AgentScheduleNotFoundError();
    await this.assertScope(authentication, grant, schedule);
    return schedule;
  }

  private async assertScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    schedule: Schedule,
  ): Promise<void> {
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: schedule.exam.ownerTeacherId,
      subjectId: schedule.exam.subjectId,
      resourceId: schedule.id,
    });
  }

  private context(
    authentication: IntegrationAuthentication,
    requestId: string,
    idempotencyKey?: string,
  ): UseCaseContext {
    const actor: ActorContext = {
      actorType: "EXTERNAL_AGENT",
      userId: authentication.client.ownerUserId,
      role: authentication.client.ownerRole,
      active: true,
      integrationClientId: authentication.client.id,
      requestId,
    };
    return idempotencyKey ? { actor, idempotencyKey } : { actor };
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: string,
    schedule: Schedule,
    requestId: string,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "schedule",
      entityId: schedule.id,
      requestId,
      outcome: "SUCCESS",
      metadata: { mode: schedule.mode, status: schedule.status },
    });
  }
}
