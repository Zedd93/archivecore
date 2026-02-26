export interface ISearchParams {
  query: string;
  filters?: ISearchFilters;
  page?: number;
  limit?: number;
}

export interface ISearchFilters {
  tenantId?: string;
  docType?: string;
  status?: string;
  locationId?: string;
  dateFrom?: string;
  dateTo?: string;
  keywords?: string[];
  entityTypes?: ('box' | 'folder' | 'hr_folder')[];
}

export interface ISearchResult {
  entityType: 'box' | 'folder' | 'hr_folder';
  entityId: string;
  title: string;
  subtitle: string | null;
  locationPath: string | null;
  status: string;
  tenantName: string;
  score: number;
}
