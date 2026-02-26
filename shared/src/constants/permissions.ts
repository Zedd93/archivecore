// ======= Permission Strings =======
export const Permissions = {
  // System
  SYSTEM_CONFIG: 'system.config',
  TENANT_MANAGE: 'tenant.manage',
  USER_MANAGE: 'user.manage',

  // Boxes
  BOX_READ: 'box.read',
  BOX_WRITE: 'box.write',
  BOX_DELETE: 'box.delete',
  BOX_MOVE: 'box.move',
  BOX_STATUS: 'box.status',

  // Folders
  FOLDER_READ: 'folder.read',
  FOLDER_WRITE: 'folder.write',

  // Documents
  DOCUMENT_READ: 'document.read',
  DOCUMENT_WRITE: 'document.write',

  // Locations
  LOCATION_READ: 'location.read',
  LOCATION_WRITE: 'location.write',

  // Orders
  ORDER_READ: 'order.read',
  ORDER_CREATE: 'order.create',
  ORDER_APPROVE: 'order.approve',
  ORDER_PROCESS: 'order.process',
  ORDER_COMPLETE: 'order.complete',

  // HR
  HR_VIEW: 'hr.view',
  HR_WRITE: 'hr.write',
  HR_VIEW_PESEL: 'hr.view_pesel',
  HR_DELETE: 'hr.delete',

  // Labels
  LABEL_READ: 'label.read',
  LABEL_GENERATE: 'label.generate',
  LABEL_TEMPLATE_MANAGE: 'label.template_manage',

  // Attachments
  ATTACHMENT_READ: 'attachment.read',
  ATTACHMENT_UPLOAD: 'attachment.upload',
  ATTACHMENT_DELETE: 'attachment.delete',

  // Search
  SEARCH_ALL: 'search.all',
  SEARCH_OWN: 'search.own',

  // Reports
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Retention
  RETENTION_MANAGE: 'retention.manage',
  DISPOSAL_INITIATE: 'disposal.initiate',
  DISPOSAL_APPROVE: 'disposal.approve',

  // Import/Export
  IMPORT_DATA: 'import.data',
  EXPORT_DATA: 'export.data',

  // Inventory
  INVENTORY_MANAGE: 'inventory.manage',

  // Transfer Lists (Spisy zdawczo-odbiorcze)
  TRANSFER_LIST_READ: 'transfer_list.read',
  TRANSFER_LIST_WRITE: 'transfer_list.write',
  TRANSFER_LIST_IMPORT: 'transfer_list.import',
} as const;

export type PermissionString = (typeof Permissions)[keyof typeof Permissions];

// ======= Role → Permissions Mapping =======
import { RoleCode } from './roles';

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionString[]> = {
  [RoleCode.SUPER_ADMIN]: Object.values(Permissions),

  [RoleCode.ADMIN_TENANT]: [
    Permissions.USER_MANAGE,
    Permissions.BOX_READ, Permissions.BOX_WRITE, Permissions.BOX_DELETE, Permissions.BOX_MOVE, Permissions.BOX_STATUS,
    Permissions.FOLDER_READ, Permissions.FOLDER_WRITE,
    Permissions.DOCUMENT_READ, Permissions.DOCUMENT_WRITE,
    Permissions.LOCATION_READ, Permissions.LOCATION_WRITE,
    Permissions.ORDER_READ, Permissions.ORDER_CREATE, Permissions.ORDER_APPROVE, Permissions.ORDER_PROCESS, Permissions.ORDER_COMPLETE,
    Permissions.HR_VIEW, Permissions.HR_WRITE, Permissions.HR_VIEW_PESEL,
    Permissions.LABEL_READ, Permissions.LABEL_GENERATE, Permissions.LABEL_TEMPLATE_MANAGE,
    Permissions.ATTACHMENT_READ, Permissions.ATTACHMENT_UPLOAD, Permissions.ATTACHMENT_DELETE,
    Permissions.SEARCH_ALL,
    Permissions.REPORT_VIEW, Permissions.REPORT_EXPORT,
    Permissions.AUDIT_VIEW,
    Permissions.RETENTION_MANAGE, Permissions.DISPOSAL_INITIATE, Permissions.DISPOSAL_APPROVE,
    Permissions.IMPORT_DATA, Permissions.EXPORT_DATA,
    Permissions.INVENTORY_MANAGE,
    Permissions.TRANSFER_LIST_READ, Permissions.TRANSFER_LIST_WRITE, Permissions.TRANSFER_LIST_IMPORT,
  ],

  [RoleCode.COORDINATOR_ARCHIVE]: [
    Permissions.BOX_READ, Permissions.BOX_WRITE, Permissions.BOX_MOVE, Permissions.BOX_STATUS,
    Permissions.FOLDER_READ, Permissions.FOLDER_WRITE,
    Permissions.DOCUMENT_READ, Permissions.DOCUMENT_WRITE,
    Permissions.LOCATION_READ, Permissions.LOCATION_WRITE,
    Permissions.ORDER_READ, Permissions.ORDER_CREATE, Permissions.ORDER_APPROVE, Permissions.ORDER_PROCESS, Permissions.ORDER_COMPLETE,
    Permissions.LABEL_READ, Permissions.LABEL_GENERATE,
    Permissions.ATTACHMENT_READ, Permissions.ATTACHMENT_UPLOAD,
    Permissions.SEARCH_ALL,
    Permissions.REPORT_VIEW, Permissions.REPORT_EXPORT,
    Permissions.DISPOSAL_INITIATE,
    Permissions.IMPORT_DATA, Permissions.EXPORT_DATA,
    Permissions.INVENTORY_MANAGE,
    Permissions.TRANSFER_LIST_READ, Permissions.TRANSFER_LIST_WRITE, Permissions.TRANSFER_LIST_IMPORT,
  ],

  [RoleCode.OPERATOR_WAREHOUSE]: [
    Permissions.BOX_READ, Permissions.BOX_WRITE, Permissions.BOX_MOVE, Permissions.BOX_STATUS,
    Permissions.FOLDER_READ,
    Permissions.LOCATION_READ,
    Permissions.ORDER_READ, Permissions.ORDER_PROCESS,
    Permissions.LABEL_READ, Permissions.LABEL_GENERATE,
    Permissions.SEARCH_ALL,
    Permissions.INVENTORY_MANAGE,
  ],

  [RoleCode.COORDINATOR_CLIENT]: [
    Permissions.BOX_READ,
    Permissions.FOLDER_READ,
    Permissions.DOCUMENT_READ,
    Permissions.ORDER_READ, Permissions.ORDER_CREATE,
    Permissions.ATTACHMENT_READ,
    Permissions.SEARCH_OWN,
    Permissions.REPORT_VIEW,
  ],

  [RoleCode.USER_HR]: [
    Permissions.HR_VIEW, Permissions.HR_WRITE, Permissions.HR_VIEW_PESEL,
    Permissions.ATTACHMENT_READ, Permissions.ATTACHMENT_UPLOAD,
    Permissions.SEARCH_OWN,
    Permissions.BOX_READ,
    Permissions.FOLDER_READ,
    Permissions.DOCUMENT_READ,
  ],

  [RoleCode.AUDITOR]: [
    Permissions.BOX_READ,
    Permissions.FOLDER_READ,
    Permissions.DOCUMENT_READ,
    Permissions.ORDER_READ,
    Permissions.HR_VIEW,
    Permissions.ATTACHMENT_READ,
    Permissions.SEARCH_ALL,
    Permissions.REPORT_VIEW, Permissions.REPORT_EXPORT,
    Permissions.AUDIT_VIEW,
    Permissions.TRANSFER_LIST_READ,
  ],

  [RoleCode.READ_ONLY]: [
    Permissions.BOX_READ,
    Permissions.FOLDER_READ,
    Permissions.DOCUMENT_READ,
    Permissions.ATTACHMENT_READ,
    Permissions.SEARCH_OWN,
  ],
};
