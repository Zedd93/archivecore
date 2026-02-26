import { ReactNode, useId } from 'react';

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export default function FormField({ label, error, required, children, className = '', htmlFor }: FormFieldProps) {
  const autoId = useId();
  const fieldId = htmlFor || autoId;

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="label-text">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-500 mt-1" role="alert">{error}</p>
      )}
    </div>
  );
}
