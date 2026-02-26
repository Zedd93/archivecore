import { ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
}

/**
 * Basic skeleton pulse block
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton for a text line
 */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for a KPI card on dashboard
 */
export function SkeletonKPICard() {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-12 w-12 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Skeleton for a DataTable row
 */
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={`h-4 ${i === 0 ? 'w-24' : i === columns - 1 ? 'w-16' : 'w-32'}`} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Skeleton for a full table
 */
export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="card p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-4 py-3 text-left">
                <Skeleton className="h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Skeleton for a detail page (info card + sidebar)
 */
export function SkeletonDetailPage() {
  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <Skeleton className="h-4 w-48" />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card space-y-4">
            <Skeleton className="h-6 w-32" />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-32" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card text-center space-y-3">
            <Skeleton className="h-4 w-16 mx-auto" />
            <Skeleton className="h-40 w-40 mx-auto rounded-lg" />
          </div>
          <div className="card space-y-3">
            <Skeleton className="h-4 w-20" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for a list page (header + filter + table)
 */
export function SkeletonListPage({ columns = 6, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </div>

      {/* Table */}
      <SkeletonTable rows={rows} columns={columns} />
    </div>
  );
}

export default Skeleton;
