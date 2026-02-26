import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  rowKey?: (item: T) => string;
  /** Enable row selection checkboxes */
  selectable?: boolean;
  /** Set of selected row IDs */
  selectedIds?: Set<string>;
  /** Called when selection changes */
  onSelectionChange?: (ids: Set<string>) => void;
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  isLoading,
  emptyMessage,
  onRowClick,
  rowKey,
  selectable,
  selectedIds,
  onSelectionChange,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const getItemId = (item: T, index: number) => rowKey ? rowKey(item) : item.id || String(index);

  const allSelected = selectable && data.length > 0 && data.every((item, i) => selectedIds?.has(getItemId(item, i)));
  const someSelected = selectable && data.some((item, i) => selectedIds?.has(getItemId(item, i)));

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      // Deselect all on current page
      const newSet = new Set(selectedIds);
      data.forEach((item, i) => newSet.delete(getItemId(item, i)));
      onSelectionChange(newSet);
    } else {
      // Select all on current page
      const newSet = new Set(selectedIds);
      data.forEach((item, i) => newSet.add(getItemId(item, i)));
      onSelectionChange(newSet);
    }
  };

  const handleSelectRow = (id: string) => {
    if (!onSelectionChange) return;
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onSelectionChange(newSet);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {emptyMessage || t('common.noData')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            {selectable && (
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  ref={el => {
                    if (el) el.indeterminate = !!(someSelected && !allSelected);
                  }}
                  onChange={handleSelectAll}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map(col => (
              <th
                scope="col"
                key={col.key}
                className={`text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((item, i) => {
            const id = getItemId(item, i);
            const isSelected = selectable && selectedIds?.has(id);
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(item)}
                className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''} ${isSelected ? 'bg-primary-50' : ''}`}
              >
                {selectable && (
                  <td className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected || false}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleSelectRow(id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      aria-label={`Select row ${i + 1}`}
                    />
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} className={`px-4 py-3 text-sm text-gray-900 ${col.className || ''}`}>
                    {col.render ? col.render(item) : item[col.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type { Column };
