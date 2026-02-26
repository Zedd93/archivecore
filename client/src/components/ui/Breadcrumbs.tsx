import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm mb-4">
      <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Home">
        <Home size={15} />
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={14} className="text-gray-300" />
          {item.to ? (
            <Link
              to={item.to}
              className="text-gray-500 hover:text-primary-600 transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-700 font-medium" aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
