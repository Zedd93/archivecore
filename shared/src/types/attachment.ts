export type OcrStatus = 'pending' | 'completed' | 'failed' | 'not_applicable';

export interface IAttachment {
  id: string;
  documentId: string | null;
  folderId: string | null;
  boxId: string | null;
  tenantId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  checksumSha256: string;
  version: number;
  ocrText: string | null;
  ocrStatus: OcrStatus;
  uploadedBy: string;
  uploadedAt: string;
}

export interface IUploadAttachment {
  entityType: 'box' | 'folder' | 'document' | 'hr_document';
  entityId: string;
}
