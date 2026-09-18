import { ApiClient, mutationHeaders } from "../../lib/api";
import { useStaffAuth } from "./auth-store";
import type {
  AcademicYear,
  AuditRow,
  ClassRecord,
  CursorPage,
  ExamRevision,
  ExamSummary,
  ExportJob,
  IntegrationAction,
  IntegrationClient,
  IntegrationClientDetail,
  MonitorPage,
  ParticipantOption,
  QuestionBankSummary,
  QuestionDraft,
  QuestionSummary,
  ResultRow,
  ScheduleSummary,
  StaffLoginResponse,
  StaffUser,
  Subject,
  TeacherScope,
} from "./types";

export interface StaffApi {
  login(username: string, password: string): Promise<StaffLoginResponse>;
  me(): Promise<StaffLoginResponse>;
  users(query?: string): Promise<CursorPage<StaffUser>>;
  previewImport(
    academicYearId: string,
    csv: string,
  ): Promise<{
    preview: {
      id: string;
      totalRows: number;
      blockingCount: number;
      createCount: number;
      updateCount: number;
      unchangedCount: number;
      duplicateCount: number;
      errorCount: number;
      expiresAt: string;
      status: string;
    };
    commitToken: string;
  }>;
  importRows(
    previewId: string,
    classification?: string,
  ): Promise<
    CursorPage<{
      rowNumber: number;
      username: string | null;
      displayName: string | null;
      classification: string;
      errors: readonly { field: string; message: string }[];
    }>
  >;
  importErrorsCsv(previewId: string): Promise<string>;
  commitImport(
    previewId: string,
    commitToken: string,
  ): Promise<{ createdUserCount: number; artifactId: string }>;
  reauth(password: string): Promise<{ verified: boolean; expiresAt: string }>;
  createUser(input: {
    username: string;
    displayName: string;
    role: string;
    password: string;
  }): Promise<StaffUser>;
  updateUser(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<StaffUser>;
  disableUser(id: string, expectedUpdatedAt?: string): Promise<StaffUser>;
  academicYears(): Promise<CursorPage<AcademicYear>>;
  createAcademicYear(input: Record<string, unknown>): Promise<AcademicYear>;
  activateAcademicYear(id: string): Promise<AcademicYear>;
  classes(academicYearId?: string): Promise<CursorPage<ClassRecord>>;
  createClass(input: Record<string, unknown>): Promise<ClassRecord>;
  subjects(): Promise<CursorPage<Subject>>;
  teacherSubjects(): Promise<CursorPage<Subject>>;
  teacherClasses(): Promise<CursorPage<ClassRecord>>;
  teacherParticipants(search?: string): Promise<CursorPage<ParticipantOption>>;
  createSubject(input: Record<string, unknown>): Promise<Subject>;
  teacherScope(teacherId?: string): Promise<TeacherScope>;
  updateTeacherScope(
    teacherId: string,
    input: TeacherScope,
  ): Promise<TeacherScope>;
  questionBanks(query?: string): Promise<CursorPage<QuestionBankSummary>>;
  createQuestionBank(
    input: Record<string, unknown>,
  ): Promise<QuestionBankSummary>;
  questions(
    query?: string,
    cursor?: string,
  ): Promise<CursorPage<QuestionSummary>>;
  question(id: string): Promise<QuestionDraft>;
  createQuestion(input: Record<string, unknown>): Promise<QuestionDraft>;
  updateQuestion(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ): Promise<QuestionDraft>;
  validateQuestion(id: string): Promise<{
    isReady: boolean;
    issues: readonly { severity: string; message: string; fieldPath: string }[];
  }>;
  publishQuestion(
    id: string,
    expectedUpdatedAt: string,
  ): Promise<QuestionDraft>;
  exams(query?: string): Promise<CursorPage<ExamSummary>>;
  examRevision(id: string): Promise<ExamRevision>;
  createExam(input: Record<string, unknown>): Promise<ExamRevision>;
  updateExam(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ): Promise<ExamRevision>;
  addExamQuestion(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ): Promise<ExamRevision>;
  removeExamQuestion(
    id: string,
    questionRevisionId: string,
    expectedUpdatedAt: string,
  ): Promise<ExamRevision>;
  reorderExamQuestions(
    id: string,
    questionRevisionIds: readonly string[],
    expectedUpdatedAt: string,
  ): Promise<ExamRevision>;
  validateExam(id: string): Promise<{
    isReady: boolean;
    errorCount: number;
    warningCount: number;
    issues: readonly { severity: string; message: string; fieldPath: string }[];
  }>;
  publishExam(id: string, expectedUpdatedAt: string): Promise<ExamRevision>;
  schedules(): Promise<CursorPage<ScheduleSummary>>;
  createSchedule(input: Record<string, unknown>): Promise<ScheduleSummary>;
  updateSchedule(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ): Promise<ScheduleSummary>;
  rotateCode(
    id: string,
    kind: "practice-token" | "main-code",
  ): Promise<{ code: string; schedule: ScheduleSummary }>;
  transitionSchedule(
    id: string,
    action: "ready" | "open" | "close",
    expectedUpdatedAt: string,
    reason?: string,
  ): Promise<ScheduleSummary>;
  monitor(
    scheduleId: string,
    cursor?: string,
    search?: string,
  ): Promise<MonitorPage>;
  extendSession(
    id: string,
    minutes: number,
    reason: string,
    expectedVersion: number,
  ): Promise<MonitorSessionLike>;
  endSession(
    id: string,
    reason: string,
    expectedVersion: number,
  ): Promise<MonitorSessionLike>;
  resetAttempt(id: string, reason: string): Promise<MonitorSessionLike>;
  results(
    scheduleId: string,
    cursor?: string,
    filter?: string,
  ): Promise<CursorPage<ResultRow>>;
  releaseResults(
    scheduleId: string,
    ids: readonly string[],
    reason?: string,
    allFiltered?: boolean,
    filter?: string,
  ): Promise<{ released: number; skipped: number; failed: number }>;
  unreleaseResults(
    scheduleId: string,
    ids: readonly string[],
    reason: string,
    allFiltered?: boolean,
    filter?: string,
  ): Promise<{ released: number; skipped: number; failed: number }>;
  exports(scheduleId?: string): Promise<CursorPage<ExportJob>>;
  createExport(
    scheduleId: string,
    input: Record<string, unknown>,
  ): Promise<ExportJob>;
  exportJob(id: string): Promise<ExportJob>;
  exportDownloadToken(
    id: string,
  ): Promise<{ token: string; expiresAt: string }>;
  audit(query?: string): Promise<CursorPage<AuditRow>>;
  integrationClients(): Promise<CursorPage<IntegrationClient>>;
  integrationClient(id: string): Promise<IntegrationClientDetail>;
  createIntegrationClient(
    input: Record<string, unknown>,
  ): Promise<IntegrationClient>;
  updateIntegrationClient(
    id: string,
    input: Record<string, unknown>,
  ): Promise<IntegrationClient>;
  issueIntegrationCredential(
    id: string,
    input?: Record<string, unknown>,
  ): Promise<{
    credential: IntegrationClientDetail["credentials"][number];
    token: string;
    warning: string;
  }>;
  revokeIntegrationCredential(
    clientId: string,
    credentialId: string,
    reason: string,
  ): Promise<{ revoked: boolean }>;
  createIntegrationGrant(
    clientId: string,
    input: Record<string, unknown>,
  ): Promise<IntegrationClientDetail["grants"][number]>;
  revokeIntegrationGrant(
    clientId: string,
    grantId: string,
    reason: string,
  ): Promise<{ revoked: boolean }>;
  integrationActions(status?: string): Promise<CursorPage<IntegrationAction>>;
  approveIntegrationAction(
    id: string,
    planHash: string,
  ): Promise<IntegrationAction>;
}

export interface MonitorSessionLike {
  readonly id: string;
  readonly status: string;
  readonly deadlineAt?: string;
  readonly finalizationReason?: string | null;
}

export class HttpStaffApi implements StaffApi {
  constructor(private readonly client = new ApiClient()) {}
  login(username: string, password: string) {
    return this.client.request<StaffLoginResponse>("/api/v1/auth/staff/login", {
      method: "POST",
      body: { username, password },
    });
  }
  me() {
    return this.client.request<StaffLoginResponse>("/api/v1/auth/me", {
      method: "GET",
    });
  }
  users(query = "") {
    return this.getPage<StaffUser>(
      `/api/v1/admin/users?search=${encodeURIComponent(query)}`,
    );
  }
  previewImport(academicYearId: string, csv: string) {
    return this.client
      .request<{
        data: {
          preview: {
            id: string;
            totalRows: number;
            blockingCount: number;
            createCount: number;
            updateCount: number;
            unchangedCount: number;
            duplicateCount: number;
            errorCount: number;
            expiresAt: string;
            status: string;
          };
          commitToken: string;
        };
      }>("/api/v1/admin/users/import/preview", {
        method: "POST",
        headers: mutationHeaders(
          crypto.randomUUID(),
          useStaffAuth().csrfToken.value,
        ),
        body: { academicYearId, csv },
      })
      .then((v) => v.data);
  }
  importRows(previewId: string, classification?: string) {
    return this.getPage<{
      rowNumber: number;
      username: string | null;
      displayName: string | null;
      classification: string;
      errors: readonly { field: string; message: string }[];
    }>(
      `/api/v1/admin/users/import-previews/${encodeURIComponent(previewId)}/rows${classification ? `?classification=${encodeURIComponent(classification)}` : ""}`,
    );
  }
  async importErrorsCsv(previewId: string): Promise<string> {
    const response = await fetch(
      `/api/v1/admin/users/import-previews/${encodeURIComponent(previewId)}/errors.csv`,
      { credentials: "include" },
    );
    return response.text();
  }
  commitImport(previewId: string, commitToken: string) {
    return this.mutate<{ createdUserCount: number; artifactId: string }>(
      "/api/v1/admin/users/import/commit",
      "POST",
      { previewId, commitToken },
    );
  }
  reauth(password: string) {
    return this.mutate<{ verified: boolean; expiresAt: string }>(
      "/api/v1/admin/users/reauth",
      "POST",
      { password },
    );
  }
  createUser(input: {
    username: string;
    displayName: string;
    role: string;
    password: string;
  }) {
    return this.mutate<StaffUser>("/api/v1/admin/users", "POST", input);
  }
  updateUser(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ) {
    return this.mutate<StaffUser>(
      `/api/v1/admin/users/${encodeURIComponent(id)}`,
      "PATCH",
      { ...input, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
    );
  }
  disableUser(id: string, expectedUpdatedAt?: string) {
    return this.mutate<StaffUser>(
      `/api/v1/admin/users/${encodeURIComponent(id)}`,
      "PATCH",
      {
        status: "DISABLED",
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      },
    );
  }
  academicYears() {
    return this.getPage<AcademicYear>("/api/v1/admin/academic-years");
  }
  createAcademicYear(input: Record<string, unknown>) {
    return this.mutate<AcademicYear>(
      "/api/v1/admin/academic-years",
      "POST",
      input,
    );
  }
  activateAcademicYear(id: string) {
    return this.mutate<AcademicYear>(
      `/api/v1/admin/academic-years/${encodeURIComponent(id)}/activate`,
      "POST",
      {},
    );
  }
  classes(academicYearId?: string) {
    return this.getPage<ClassRecord>(
      `/api/v1/admin/classes${academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : ""}`,
    );
  }
  createClass(input: Record<string, unknown>) {
    return this.mutate<ClassRecord>("/api/v1/admin/classes", "POST", input);
  }
  subjects() {
    return this.getPage<Subject>("/api/v1/admin/subjects");
  }
  teacherSubjects() {
    return this.getPage<Subject>("/api/v1/teacher/subjects");
  }
  teacherClasses() {
    return this.getPage<ClassRecord>("/api/v1/teacher/classes");
  }
  teacherParticipants(search = "") {
    return this.getPage<ParticipantOption>(
      `/api/v1/teacher/participants${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    );
  }
  createSubject(input: Record<string, unknown>) {
    return this.mutate<Subject>("/api/v1/admin/subjects", "POST", input);
  }
  teacherScope(teacherId = "me") {
    return this.client
      .request<{ data: TeacherScope }>(
        `/api/v1/teacher/scopes/${encodeURIComponent(teacherId)}`,
      )
      .then((v) => v.data);
  }
  updateTeacherScope(teacherId: string, input: TeacherScope) {
    return this.mutate<TeacherScope>(
      `/api/v1/admin/teachers/${encodeURIComponent(teacherId)}/scopes`,
      "PUT",
      input,
    );
  }
  questionBanks(query = "") {
    return this.getPage<QuestionBankSummary>(
      `/api/v1/teacher/question-banks?search=${encodeURIComponent(query)}`,
    );
  }
  createQuestionBank(input: Record<string, unknown>) {
    return this.mutate<QuestionBankSummary>(
      "/api/v1/teacher/question-banks",
      "POST",
      input,
    );
  }
  questions(query = "", cursor?: string) {
    return this.getPage<QuestionSummary>(
      `/api/v1/teacher/questions?${new URLSearchParams({
        ...(query ? { search: query } : {}),
        ...(cursor ? { cursor } : {}),
      })}`,
    );
  }
  question(id: string) {
    return this.getData<QuestionDraft>(
      `/api/v1/teacher/question-revisions/${encodeURIComponent(id)}`,
    );
  }
  createQuestion(input: Record<string, unknown>) {
    const questionBankId = String(input.questionBankId ?? "");
    const { questionBankId: _questionBankId, ...content } = input;
    return this.mutate<QuestionDraft>(
      `/api/v1/teacher/question-banks/${encodeURIComponent(questionBankId)}/questions`,
      "POST",
      content,
    );
  }
  updateQuestion(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ) {
    return this.mutate<QuestionDraft>(
      `/api/v1/teacher/question-revisions/${encodeURIComponent(id)}`,
      "PATCH",
      { ...input, expectedUpdatedAt },
    );
  }
  validateQuestion(id: string) {
    return this.mutate<{
      isReady: boolean;
      issues: readonly {
        severity: string;
        message: string;
        fieldPath: string;
      }[];
    }>(
      `/api/v1/teacher/question-revisions/${encodeURIComponent(id)}/validate`,
      "POST",
      {},
    );
  }
  publishQuestion(id: string, expectedUpdatedAt: string) {
    return this.mutate<QuestionDraft>(
      `/api/v1/teacher/question-revisions/${encodeURIComponent(id)}/publish`,
      "POST",
      { expectedUpdatedAt },
    );
  }
  exams(query = "") {
    return this.getPage<ExamSummary>(
      `/api/v1/teacher/exams?search=${encodeURIComponent(query)}`,
    );
  }
  examRevision(id: string) {
    return this.getData<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}`,
    );
  }
  createExam(input: Record<string, unknown>) {
    return this.mutate<ExamRevision>("/api/v1/teacher/exams", "POST", input);
  }
  updateExam(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ) {
    return this.mutate<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}`,
      "PATCH",
      { ...input, expectedUpdatedAt },
    );
  }
  addExamQuestion(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ) {
    return this.mutate<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}/questions`,
      "POST",
      { ...input, expectedUpdatedAt },
    );
  }
  removeExamQuestion(
    id: string,
    questionRevisionId: string,
    expectedUpdatedAt: string,
  ) {
    return this.mutate<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}/questions/${encodeURIComponent(questionRevisionId)}`,
      "DELETE",
      { expectedUpdatedAt },
    );
  }
  reorderExamQuestions(
    id: string,
    questionRevisionIds: readonly string[],
    expectedUpdatedAt: string,
  ) {
    return this.mutate<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}/questions/order`,
      "PUT",
      { questionRevisionIds, expectedUpdatedAt },
    );
  }
  validateExam(id: string) {
    return this.mutate<{
      isReady: boolean;
      errorCount: number;
      warningCount: number;
      issues: readonly {
        severity: string;
        message: string;
        fieldPath: string;
      }[];
    }>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}/validate`,
      "POST",
      {},
    );
  }
  publishExam(id: string, expectedUpdatedAt: string) {
    return this.mutate<ExamRevision>(
      `/api/v1/teacher/exam-revisions/${encodeURIComponent(id)}/publish`,
      "POST",
      { expectedUpdatedAt },
    );
  }
  schedules() {
    return this.getPage<ScheduleSummary>("/api/v1/teacher/schedules");
  }
  createSchedule(input: Record<string, unknown>) {
    return this.mutate<ScheduleSummary>(
      "/api/v1/teacher/schedules",
      "POST",
      input,
    );
  }
  updateSchedule(
    id: string,
    input: Record<string, unknown>,
    expectedUpdatedAt: string,
  ) {
    return this.mutate<ScheduleSummary>(
      `/api/v1/teacher/schedules/${encodeURIComponent(id)}`,
      "PATCH",
      { ...input, expectedUpdatedAt },
    );
  }
  rotateCode(id: string, kind: "practice-token" | "main-code") {
    return this.getData<ScheduleSummary>(
      `/api/v1/teacher/schedules/${encodeURIComponent(id)}`,
    ).then((schedule) =>
      this.mutate<{ scheduleId: string; code: string; hint: string }>(
        `/api/v1/teacher/schedules/${encodeURIComponent(id)}/rotate-${kind}`,
        "POST",
        { expectedUpdatedAt: schedule.updatedAt },
      ).then((result) => ({ code: result.code, schedule })),
    );
  }
  transitionSchedule(
    id: string,
    action: "ready" | "open" | "close",
    expectedUpdatedAt: string,
    reason?: string,
  ) {
    return this.mutate<ScheduleSummary>(
      `/api/v1/teacher/schedules/${encodeURIComponent(id)}/${action}`,
      "POST",
      {
        expectedUpdatedAt,
        ...(reason ? { closeReason: reason } : {}),
      },
    );
  }
  monitor(scheduleId: string, cursor?: string, search?: string) {
    return this.client
      .request<{ data: MonitorPage }>(
        `/api/v1/teacher/schedules/${encodeURIComponent(scheduleId)}/monitor?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(search ? { search } : {}) })}`,
        { method: "GET" },
      )
      .then((v) => v.data);
  }
  extendSession(
    id: string,
    minutes: number,
    reason: string,
    expectedVersion: number,
  ) {
    return this.mutate<MonitorSessionLike>(
      `/api/v1/teacher/exam-sessions/${encodeURIComponent(id)}/extend-time`,
      "POST",
      { minutes, reason, expectedVersion },
    );
  }
  endSession(id: string, reason: string, expectedVersion: number) {
    return this.mutate<MonitorSessionLike>(
      `/api/v1/teacher/exam-sessions/${encodeURIComponent(id)}/end`,
      "POST",
      { reason, expectedVersion },
    );
  }
  resetAttempt(id: string, reason: string) {
    return this.mutate<MonitorSessionLike>(
      `/api/v1/admin/exam-sessions/${encodeURIComponent(id)}/reset-attempt`,
      "POST",
      { reason },
    );
  }
  results(scheduleId: string, cursor?: string, filter?: string) {
    return this.getPage<ResultRow>(
      `/api/v1/teacher/schedules/${encodeURIComponent(scheduleId)}/results?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(filter ? { filter } : {}) })}`,
    );
  }
  releaseResults(
    scheduleId: string,
    ids: readonly string[],
    reason?: string,
    allFiltered = false,
    filter = "ALL",
  ) {
    return this.mutate<{ released: number; skipped: number; failed: number }>(
      `/api/v1/teacher/schedules/${encodeURIComponent(scheduleId)}/release-results`,
      "POST",
      { ids, allFiltered, filter, ...(reason ? { reason } : {}) },
    );
  }
  unreleaseResults(
    scheduleId: string,
    ids: readonly string[],
    reason: string,
    allFiltered = false,
    filter = "ALL",
  ) {
    return this.mutate<{ released: number; skipped: number; failed: number }>(
      `/api/v1/teacher/schedules/${encodeURIComponent(scheduleId)}/unrelease-results`,
      "POST",
      { ids, reason, allFiltered, filter },
    );
  }
  exports(scheduleId?: string) {
    return this.getPage<ExportJob>(
      `/api/v1/teacher/exports${scheduleId ? `?scheduleId=${encodeURIComponent(scheduleId)}` : ""}`,
    );
  }
  createExport(scheduleId: string, input: Record<string, unknown>) {
    return this.mutate<ExportJob>(
      `/api/v1/teacher/schedules/${encodeURIComponent(scheduleId)}/exports`,
      "POST",
      input,
    );
  }
  exportJob(id: string) {
    return this.getData<ExportJob>(
      `/api/v1/teacher/exports/${encodeURIComponent(id)}`,
    );
  }
  exportDownloadToken(id: string) {
    return this.mutate<{ token: string; expiresAt: string }>(
      `/api/v1/teacher/exports/${encodeURIComponent(id)}/download-token`,
      "POST",
      {},
    );
  }
  audit(query = "") {
    return this.getPage<AuditRow>(
      `/api/v1/admin/audit-logs?search=${encodeURIComponent(query)}`,
    );
  }
  integrationClients() {
    return this.getPage<IntegrationClient>("/api/v1/admin/integration-clients");
  }
  integrationClient(id: string) {
    return this.getData<IntegrationClientDetail>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(id)}`,
    );
  }
  createIntegrationClient(input: Record<string, unknown>) {
    return this.mutate<IntegrationClient>(
      "/api/v1/admin/integration-clients",
      "POST",
      input,
    );
  }
  updateIntegrationClient(id: string, input: Record<string, unknown>) {
    return this.mutate<IntegrationClient>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(id)}`,
      "PATCH",
      input,
    );
  }
  issueIntegrationCredential(id: string, input: Record<string, unknown> = {}) {
    return this.mutate<{
      credential: IntegrationClientDetail["credentials"][number];
      token: string;
      warning: string;
    }>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(id)}/credentials`,
      "POST",
      input,
    );
  }
  revokeIntegrationCredential(
    clientId: string,
    credentialId: string,
    reason: string,
  ) {
    return this.mutate<{ revoked: boolean }>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(credentialId)}`,
      "DELETE",
      { reason },
    );
  }
  createIntegrationGrant(clientId: string, input: Record<string, unknown>) {
    return this.mutate<IntegrationClientDetail["grants"][number]>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(clientId)}/grants`,
      "POST",
      input,
    );
  }
  revokeIntegrationGrant(clientId: string, grantId: string, reason: string) {
    return this.mutate<{ revoked: boolean }>(
      `/api/v1/admin/integration-clients/${encodeURIComponent(clientId)}/grants/${encodeURIComponent(grantId)}`,
      "DELETE",
      { reason },
    );
  }
  integrationActions(status = "AWAITING_APPROVAL") {
    return this.getPage<IntegrationAction>(
      `/api/v1/admin/integration-actions?status=${encodeURIComponent(status)}`,
    );
  }
  approveIntegrationAction(id: string, planHash: string) {
    return this.mutate<IntegrationAction>(
      `/api/v1/admin/integration-actions/${encodeURIComponent(id)}/approve`,
      "POST",
      { planHash },
    );
  }
  private async getData<T>(path: string): Promise<T> {
    const result = await this.client.request<{ data: T }>(path, {
      method: "GET",
    });
    return result.data;
  }
  private async getPage<T>(path: string): Promise<CursorPage<T>> {
    const result = await this.client.request<{ data: CursorPage<T> }>(path, {
      method: "GET",
    });
    return result.data;
  }
  private async mutate<T>(
    path: string,
    method: string,
    body: unknown,
  ): Promise<T> {
    const response = await this.client.request<{ data: T }>(path, {
      method,
      headers: mutationHeaders(
        crypto.randomUUID(),
        useStaffAuth().csrfToken.value,
      ),
      body,
    });
    return response.data;
  }
}
