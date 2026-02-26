import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import i18n from '@/i18n/config';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="card max-w-md w-full text-center py-10 px-8">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertTriangle className="text-red-500" size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {i18n.t('common.errorBoundary.title')}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {i18n.t('common.errorBoundary.description')}
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-6 p-3 bg-red-50 rounded-lg text-left">
                <p className="text-xs font-mono text-red-700 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="btn-primary flex items-center gap-2"
              >
                <RefreshCw size={16} />
                {i18n.t('common.tryAgain')}
              </button>
              <button
                onClick={this.handleGoHome}
                className="btn-secondary flex items-center gap-2"
              >
                <Home size={16} />
                {i18n.t('common.goHome')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
