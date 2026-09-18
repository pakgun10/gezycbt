type FixtureParticipant = {
  readonly username: string;
  readonly password: string;
  readonly mainAccessCode?: string;
};

function readOption(name: string, fallback?: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  if (index < 0) return fallback;
  return Bun.argv[index + 1];
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value ?? "");
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1500)
    throw new Error(`${name} must be an integer between 1 and 1500`);
  return parsed;
}

const count = positiveInteger(readOption("--count", "1000"), "--count");
const output = readOption("--output", "./participants.json");
if (!output) throw new Error("--output is required");
const password = Bun.env.K6_FIXTURE_PASSWORD ?? "replace-in-staging";
const mainAccessCode = Bun.env.K6_MAIN_ACCESS_CODE;

const participants: FixtureParticipant[] = Array.from(
  { length: count },
  (_, index) => ({
    username: `load-participant-${String(index + 1).padStart(4, "0")}`,
    password,
    ...(mainAccessCode ? { mainAccessCode } : {}),
  }),
);

await Bun.write(
  output,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning:
        "Staging-only fixture. Create accounts through the official import workflow.",
      participants,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${participants.length} participant fixture records to ${output}`);
