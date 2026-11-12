import { createHash } from 'node:crypto';

export type SemanticMetadataSource = 'folder' | 'transfer_list';

export function semanticMetadataText(...parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join(' | ').slice(0, 1500);
}

export function semanticDepartmentKey(department: string | null | undefined): string | null {
  return department?.trim().toLocaleLowerCase('pl-PL') || null;
}

export function semanticMetadataChecksum(source: {
  sourceType: SemanticMetadataSource;
  text: string;
  department?: string | null;
}): string {
  return createHash('sha256').update(JSON.stringify([
    'semantic-metadata-v1', source.sourceType, source.text, semanticDepartmentKey(source.department),
  ])).digest('hex');
}
