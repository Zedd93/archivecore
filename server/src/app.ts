import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config/env';
import { errorHandler } from './middleware/error-handler';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import boxRoutes from './modules/boxes/box.routes';
import locationRoutes from './modules/locations/location.routes';
import orderRoutes from './modules/orders/order.routes';
import hrRoutes from './modules/hr/hr.routes';
import labelRoutes from './modules/labels/label.routes';
import searchRoutes from './modules/search/search.routes';
import folderRoutes from './modules/folders/folder.routes';
import documentRoutes from './modules/documents/document.routes';
import attachmentRoutes from './modules/attachments/attachment.routes';
import userRoutes from './modules/users/user.routes';
import tenantRoutes from './modules/tenants/tenant.routes';
import reportRoutes from './modules/reports/report.routes';
import auditRoutes from './modules/audit/audit.routes';
import retentionRoutes from './modules/retention/retention.routes';
import transferListRoutes from './modules/transfer-lists/transfer-list.routes';
import importExportRoutes from './modules/import-export/import-export.routes';
import shareLinkRoutes from './modules/share-links/share-link.routes';
import { ShareLinkController } from './modules/share-links/share-link.controller';

const app = express();

// ─── Global Middleware ────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Health Check ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    env: config.nodeEnv,
  });
});

// ─── API Routes ───────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/boxes', boxRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/retention', retentionRoutes);
app.use('/api/transfer-lists', transferListRoutes);
app.use('/api', importExportRoutes);
app.use('/api/share-links', shareLinkRoutes);

// ─── Public routes (no auth) ─────────────────────────────
app.get('/api/public/share/:token', ShareLinkController.publicAccess);

// ─── Serve React Frontend in Production ──────────────────
if (config.nodeEnv === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // All non-API routes → React index.html (SPA)
  app.get('*', (_req, res) => {
    if (_req.originalUrl.startsWith('/api/')) {
      return res.status(404).json({
        success: false,
        error: 'Nie znaleziono zasobu',
        path: _req.originalUrl,
      });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // ─── 404 Handler (dev only — Vite serves frontend) ──────
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Nie znaleziono zasobu',
      path: _req.originalUrl,
    });
  });
}

// ─── Global Error Handler ─────────────────────────────────
app.use(errorHandler);

export default app;
