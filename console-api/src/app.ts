import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestId } from './middleware/request';
import { errorHandler, notFoundRoute } from './middleware/error';
import authRoutes, { meRoute } from './modules/auth/routes';
import businessRoutes from './modules/businesses/routes';
import catalogRoutes from './modules/catalog/routes';
import teamRoutes from './modules/team/routes';
import systemRoutes from './modules/system/routes';
import billingRoutes, { publicBilling } from './modules/billing/routes';
import partnerRoutes from './modules/partners/routes';
import applicationRoutes, { publicApplications } from './modules/partners/applications';
import fileRoutes from './modules/partners/files';

export const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.APP_ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => ((req as unknown as { rawBody: Buffer }).rawBody = buf) }));
app.use(cookieParser());
app.use(requestId);

const api = Router();
api.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'console-api' });
});
api.use('/', publicBilling); // gateway webhooks and the dev test pay page: no login
api.use('/public', publicApplications); // the website's sell-AHEAD form: no login
api.use('/auth', authRoutes);
api.use('/me', meRoute);
api.use('/businesses', businessRoutes);
api.use('/catalog', catalogRoutes);
api.use('/team', teamRoutes);
api.use('/system', systemRoutes);
api.use('/billing', billingRoutes);
api.use('/partners', partnerRoutes);
api.use('/applications', applicationRoutes);
api.use('/files', fileRoutes);

app.use('/api/v1', api);
app.use(notFoundRoute);
app.use(errorHandler);
