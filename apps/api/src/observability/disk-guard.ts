import { statfs } from "node:fs/promises";

export type DiskWorkload = "upload" | "export" | "backup";

export interface DiskSnapshot {
  readonly path: string;
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly freeRatio: number;
}

export class DiskProtectionError extends Error {
  readonly code = "DISK_PROTECTION";

  constructor(
    readonly workload: DiskWorkload,
    readonly snapshot: DiskSnapshot,
  ) {
    super("Persistent storage is below the safety threshold");
    this.name = "DiskProtectionError";
  }
}

export interface DiskGuardOptions {
  /** Reject non-essential writes at or below this ratio (default 10%). */
  readonly rejectBelowRatio?: number;
  /** Alert threshold exposed to operators (default 20%). */
  readonly warnBelowRatio?: number;
  readonly statfsFn?: DiskStatFs;
}

type DiskStatFs = (path: string) => Promise<{
  readonly blocks: number;
  readonly bsize: number;
  readonly bavail: number;
}>;

/**
 * Disk protection is deliberately small and process-local. It protects the
 * write path; monitoring/alerting remains an operator concern. The guard is
 * checked before media and export writes so a full disk cannot take down the
 * exam answer path.
 */
export class FilesystemDiskGuard {
  private readonly rejectBelowRatio: number;
  private readonly warnBelowRatio: number;
  private readonly statfsFn: DiskStatFs;

  constructor(
    private readonly path: string,
    options: DiskGuardOptions = {},
  ) {
    this.rejectBelowRatio = options.rejectBelowRatio ?? 0.1;
    this.warnBelowRatio = options.warnBelowRatio ?? 0.2;
    if (
      !Number.isFinite(this.rejectBelowRatio) ||
      this.rejectBelowRatio <= 0 ||
      this.rejectBelowRatio >= 1 ||
      !Number.isFinite(this.warnBelowRatio) ||
      this.warnBelowRatio <= this.rejectBelowRatio ||
      this.warnBelowRatio >= 1
    )
      throw new RangeError(
        "Disk thresholds must satisfy 0 < reject < warn < 1",
      );
    this.statfsFn = options.statfsFn ?? statfs;
  }

  async snapshot(): Promise<DiskSnapshot> {
    const value = await this.statfsFn(this.path);
    const totalBytes = Number(value.blocks) * Number(value.bsize);
    const freeBytes = Number(value.bavail) * Number(value.bsize);
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;
    return { path: this.path, freeBytes, totalBytes, freeRatio };
  }

  async assertAvailable(workload: DiskWorkload): Promise<DiskSnapshot> {
    const current = await this.snapshot();
    if (current.freeRatio <= this.rejectBelowRatio)
      throw new DiskProtectionError(workload, current);
    return current;
  }

  async isWarning(): Promise<boolean> {
    return (await this.snapshot()).freeRatio <= this.warnBelowRatio;
  }
}
