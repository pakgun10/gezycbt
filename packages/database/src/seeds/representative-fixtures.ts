export interface RepresentativeFixtureOptions {
  readonly seed?: string;
  readonly participantCount?: number;
  readonly classCount?: number;
  readonly teacherCount?: number;
  readonly subjectCount?: number;
}

export interface RepresentativeClass {
  readonly code: string;
  readonly name: string;
}

export interface RepresentativeSubject {
  readonly code: string;
  readonly name: string;
}

export interface RepresentativeTeacher {
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
}

export interface RepresentativeParticipant {
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly classCode: string;
}

export interface RepresentativeTeacherScope {
  readonly teacherUsername: string;
  readonly subjectCodes: readonly string[];
  readonly classCodes: readonly string[];
}

export interface RepresentativeFixture {
  readonly seed: string;
  readonly academicYear: {
    readonly name: string;
    readonly startsOn: string;
    readonly endsOn: string;
  };
  readonly classes: readonly RepresentativeClass[];
  readonly subjects: readonly RepresentativeSubject[];
  readonly teachers: readonly RepresentativeTeacher[];
  readonly participants: readonly RepresentativeParticipant[];
  readonly teacherScopes: readonly RepresentativeTeacherScope[];
}

const FIXTURE_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$xj6T/Uz/y58PA1IStE+jsV1ZnsXLGu5R5LC59/rNSrI$zDM46T4vNjnoa2vqe0nPTjogovPdUWfWS1BPe30BW5w";

export function generateRepresentativeFixture(
  options: RepresentativeFixtureOptions = {},
): RepresentativeFixture {
  const seed = normalizeSeed(options.seed ?? "default-v1");
  const participantCount = boundedCount(
    options.participantCount ?? 1_500,
    1,
    1_500,
    "participantCount",
  );
  const classCount = boundedCount(
    options.classCount ?? 6,
    1,
    100,
    "classCount",
  );
  const teacherCount = boundedCount(
    options.teacherCount ?? 12,
    1,
    100,
    "teacherCount",
  );
  const subjectCount = boundedCount(
    options.subjectCount ?? 8,
    1,
    100,
    "subjectCount",
  );
  const slug = seedSlug(seed);
  const offset = hashSeed(seed);
  const classes = Array.from({ length: classCount }, (_, index) => ({
    code: `FX-${slug}-C${String(index + 1).padStart(2, "0")}`.slice(0, 50),
    name: `Fixture ${slug} Class ${index + 1}`.slice(0, 150),
  }));
  const subjects = Array.from({ length: subjectCount }, (_, index) => ({
    code: `FX-${slug}-S${String(index + 1).padStart(2, "0")}`.slice(0, 50),
    name: `Fixture ${slug} Subject ${index + 1}`.slice(0, 150),
  }));
  const teachers = Array.from({ length: teacherCount }, (_, index) => ({
    username: `fx_${slug}_teacher_${String(index + 1).padStart(3, "0")}`,
    displayName: `Fixture ${slug} Teacher ${index + 1}`,
    passwordHash: FIXTURE_PASSWORD_HASH,
  }));
  const participants = Array.from({ length: participantCount }, (_, index) => ({
    username: `fx_${slug}_participant_${String(index + 1).padStart(4, "0")}`,
    displayName: `Fixture ${slug} Participant ${index + 1}`,
    passwordHash: FIXTURE_PASSWORD_HASH,
    classCode:
      classes[(index + offset) % classes.length]?.code ??
      classes[0]?.code ??
      "",
  }));
  const teacherScopes = teachers.map((teacher, index) => ({
    teacherUsername: teacher.username,
    subjectCodes: [
      subjects[index % subjects.length]?.code ?? "",
      subjects[(index + 1) % subjects.length]?.code ?? "",
    ],
    classCodes: [
      classes[(index + offset) % classes.length]?.code ?? "",
      classes[(index + 1 + offset) % classes.length]?.code ?? "",
    ],
  }));
  return {
    seed,
    academicYear: {
      name: `Fixture ${slug} 2026/2027`.slice(0, 50),
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
    },
    classes,
    subjects,
    teachers,
    participants,
    teacherScopes,
  };
}

function normalizeSeed(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (
    !normalized ||
    normalized.length > 24 ||
    !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new Error("Fixture seed must be 1-24 ASCII letters, digits, _ or -");
  }
  return normalized;
}

function seedSlug(seed: string): string {
  return seed
    .replace(/[^A-Za-z0-9]/gu, "-")
    .toUpperCase()
    .slice(0, 12);
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 10_000;
}

function boundedCount(
  value: number,
  min: number,
  max: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}
