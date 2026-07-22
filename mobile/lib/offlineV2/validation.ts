import { isSha256Hex } from './manifest';
import type { OfflineBundleArtifactV2 } from './types';

export type OfflineArtifactFileInfo = Readonly<{
  exists: boolean;
  isDirectory: boolean;
  size: number;
}>;

export type OfflineArtifactValidationAdapter = Readonly<{
  info(path: string): Promise<OfflineArtifactFileInfo>;
  sha256(path: string): Promise<string>;
}>;

export type OfflineArtifactValidationResult = Readonly<{
  valid: boolean;
  code: 'valid' | 'invalid_descriptor' | 'missing' | 'not_a_file' | 'size_mismatch' | 'sha256_mismatch' | 'io_error';
  expected_bytes: number;
  actual_bytes?: number;
  expected_sha256?: string;
  actual_sha256?: string;
  message: string;
}>;

export async function validateOfflineArtifactFile(
  files: OfflineArtifactValidationAdapter,
  artifact: Pick<OfflineBundleArtifactV2, 'id' | 'bytes' | 'sha256' | 'integrity' | 'size_kind' | 'storage'>,
  path: string,
): Promise<OfflineArtifactValidationResult> {
  const base = {
    expected_bytes: artifact.bytes,
    ...(artifact.sha256 ? { expected_sha256: artifact.sha256.toLowerCase() } : {}),
  };
  if (artifact.storage !== 'file'
    || artifact.size_kind !== 'exact'
    || artifact.integrity !== 'sha256'
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes < 0
    || !isSha256Hex(artifact.sha256)) {
    return { valid: false, code: 'invalid_descriptor', ...base, message: `Artifact ${artifact.id} has invalid integrity metadata.` };
  }
  try {
    const info = await files.info(path);
    if (!info.exists) return { valid: false, code: 'missing', ...base, message: `Artifact ${artifact.id} is missing.` };
    if (info.isDirectory) {
      return { valid: false, code: 'not_a_file', ...base, actual_bytes: info.size, message: `Artifact ${artifact.id} is not a file.` };
    }
    if (info.size !== artifact.bytes) {
      return {
        valid: false,
        code: 'size_mismatch',
        ...base,
        actual_bytes: info.size,
        message: `Artifact ${artifact.id} has the wrong size.`,
      };
    }
    const digest = (await files.sha256(path)).toLowerCase();
    if (digest !== artifact.sha256.toLowerCase()) {
      return {
        valid: false,
        code: 'sha256_mismatch',
        ...base,
        actual_bytes: info.size,
        actual_sha256: digest,
        message: `Artifact ${artifact.id} failed checksum verification.`,
      };
    }
    return {
      valid: true,
      code: 'valid',
      ...base,
      actual_bytes: info.size,
      actual_sha256: digest,
      message: `Artifact ${artifact.id} is verified.`,
    };
  } catch (error) {
    return {
      valid: false,
      code: 'io_error',
      ...base,
      message: error instanceof Error ? error.message : `Artifact ${artifact.id} could not be read.`,
    };
  }
}
