import type { Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import {
  AcademicNotFoundError,
  type AcademicPage,
  type AcademicYear,
  type ClassMember,
  type ClassMemberProfile,
  type ClassRecord,
  type CreateAcademicYearInput,
  type CreateClassInput,
  type CreateSubjectInput,
  type PageRequest,
  type ScopeInput,
  type Subject,
  type TeacherScope,
  type UpdateClassInput,
  type UpdateSubjectInput,
} from "./domain";
import type { AcademicRepository } from "./repository";

export class AcademicMasterService {
  constructor(private readonly repository: AcademicRepository) {}

  listAcademicYears(
    context: UseCaseContext,
    request: PageRequest,
  ): Promise<AcademicPage<AcademicYear>> {
    assertActorContext(context.actor);
    return this.repository.listAcademicYears(request);
  }

  async createAcademicYear(
    context: UseCaseContext,
    input: CreateAcademicYearInput,
  ): Promise<AcademicYear> {
    assertMutationContext(context);
    return this.repository.createAcademicYear(input);
  }

  async activateAcademicYear(
    context: UseCaseContext,
    id: Id,
  ): Promise<AcademicYear> {
    assertMutationContext(context);
    const year = await this.repository.setAcademicYearActive(id);
    if (!year) throw new AcademicNotFoundError("Academic year");
    return year;
  }

  listClasses(
    context: UseCaseContext,
    academicYearId: Id | undefined,
    request: PageRequest,
  ): Promise<AcademicPage<ClassRecord>> {
    assertActorContext(context.actor);
    return this.repository.listClasses(academicYearId, request);
  }

  createClass(
    context: UseCaseContext,
    input: CreateClassInput,
  ): Promise<ClassRecord> {
    assertMutationContext(context);
    return this.repository.createClass(input);
  }

  async updateClass(
    context: UseCaseContext,
    id: Id,
    input: UpdateClassInput,
  ): Promise<ClassRecord> {
    assertMutationContext(context);
    const classRecord = await this.repository.updateClass(id, input);
    if (!classRecord) throw new AcademicNotFoundError("Class");
    return classRecord;
  }

  listClassMembers(
    context: UseCaseContext,
    classId: Id,
    request: PageRequest,
  ): Promise<AcademicPage<ClassMember>> {
    assertActorContext(context.actor);
    return this.repository.listClassMembers(classId, request);
  }

  listClassMemberProfiles(
    context: UseCaseContext,
    classId: Id,
  ): Promise<readonly ClassMemberProfile[]> {
    assertActorContext(context.actor);
    return this.repository.listClassMemberProfiles(classId);
  }

  replaceClassMembers(
    context: UseCaseContext,
    classId: Id,
    participantIds: readonly Id[],
  ): Promise<readonly ClassMember[]> {
    assertMutationContext(context);
    return this.repository.replaceClassMembers(classId, participantIds);
  }

  listSubjects(
    context: UseCaseContext,
    request: PageRequest,
  ): Promise<AcademicPage<Subject>> {
    assertActorContext(context.actor);
    return this.repository.listSubjects(request);
  }

  createSubject(
    context: UseCaseContext,
    input: CreateSubjectInput,
  ): Promise<Subject> {
    assertMutationContext(context);
    return this.repository.createSubject(input);
  }

  async updateSubject(
    context: UseCaseContext,
    id: Id,
    input: UpdateSubjectInput,
  ): Promise<Subject> {
    assertMutationContext(context);
    const subject = await this.repository.updateSubject(id, input);
    if (!subject) throw new AcademicNotFoundError("Subject");
    return subject;
  }

  getTeacherScopes(
    context: UseCaseContext,
    teacherId: Id,
  ): Promise<TeacherScope | null> {
    assertActorContext(context.actor);
    return this.repository.getTeacherScopes(teacherId);
  }

  replaceTeacherScopes(
    context: UseCaseContext,
    teacherId: Id,
    input: ScopeInput,
  ): Promise<TeacherScope> {
    assertMutationContext(context);
    return this.repository.replaceTeacherScopes(teacherId, input);
  }
}
