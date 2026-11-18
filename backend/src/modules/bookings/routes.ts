import { Router } from 'express';
import { z } from 'zod';
import { withPlatform } from '../../kernel/db';
import { IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { publicRoute, requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { publicLimiter } from '../../middleware/rateLimit';
import * as bk from './service';

// Calendar & Bookings (BKG-01, BKG-02, BKG-08): appointments, services, rooms, staff hours, free
// slots and the online booking page. Logic lives in service.ts.

/** The online booking page: no login, rate-limited */
export const publicBookings = Router();
publicBookings.get('/public/book/:slug', publicRoute, publicLimiter, async (req, res) => {
  res.json(await withPlatform(() => bk.publicPage(String(req.params.slug))));
});
publicBookings.get('/public/book/:slug/slots', publicRoute, publicLimiter, validate(bk.SlotQuery, 'query'), async (req, res) => {
  res.json(await withPlatform(() => bk.publicSlots(String(req.params.slug), req.query as unknown as z.infer<typeof bk.SlotQuery>)));
});
publicBookings.post('/public/book/:slug', publicRoute, publicLimiter, validate(bk.PublicBookInput), async (req, res) => {
  res.status(201).json(await withPlatform(() => bk.publicBook(String(req.params.slug), req.body)));
});

const router = Router();
router.use(tenantAuth);
const VIEW = requirePermission('bookings.appointment.view');
const RES = (a: string) => requirePermission(`bookings.resource.${a}`);

// ── Appointments ──
router.get('/appointments', VIEW, validate(bk.AppointmentList, 'query'), tx(async (req, res) => {
  res.json(await bk.listAppointments(req.ctx!, req.query as unknown as z.infer<typeof bk.AppointmentList>));
}));
router.post('/appointments', validate(bk.AppointmentInput), async (req, res, next) => {
  // The permission depends on the kind (appointment or calendar event)
  await requirePermission(`bookings.${req.body.kind === 'event' ? 'event' : 'appointment'}.create`)(req, res, next);
}, tx(async (req, res) => {
  res.status(201).json(await bk.createAppointment(req.ctx!, req.body));
}));
router.patch('/appointments/:id', requirePermission('bookings.appointment.edit'), validate(IdParam, 'params'), validate(bk.AppointmentInput.partial().extend({ version: z.number().int().optional() })), tx(async (req, res) => {
  res.json(await bk.updateAppointment(req.ctx!, String(req.params.id), req.body));
}));
router.post('/appointments/:id/status', requirePermission('bookings.appointment.edit'), validate(IdParam, 'params'), validate(z.object({ action: z.enum(['confirm', 'check_in', 'complete', 'no_show', 'cancel', 'reopen']), reason: z.string().trim().max(300).optional().nullable() })), tx(async (req, res) => {
  res.json(await bk.setStatus(req.ctx!, String(req.params.id), req.body.action, req.body.reason));
}));
router.post('/appointments/:id/reminded', requirePermission('bookings.appointment.edit'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await bk.markReminded(req.ctx!, String(req.params.id)));
}));
router.delete('/appointments/:id', requirePermission('bookings.appointment.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await bk.deleteAppointment(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.post('/appointments/:id/invoice', requirePermission('billing.invoice.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.status(201).json(await bk.invoiceAppointment(req.ctx!, String(req.params.id)));
}));

// ── Free slots, for the booking form ──
router.get('/booking-slots', VIEW, validate(bk.SlotQuery, 'query'), tx(async (req, res) => {
  res.json(await bk.freeSlots(req.ctx!.tenantId, req.query as unknown as z.infer<typeof bk.SlotQuery>, { stepMin: 15 }));
}));

// ── Services ──
router.get('/booking-services', VIEW, tx(async (req, res) => {
  res.json(await bk.listServices(req.ctx!));
}));
router.put('/booking-services/:id', RES('edit'), validate(IdParam, 'params'), validate(bk.ServiceInput), tx(async (req, res) => {
  res.json(await bk.saveService(req.ctx!, String(req.params.id), req.body));
}));

// ── Rooms, chairs, machines ──
router.get('/booking-resources', VIEW, tx(async (req, res) => {
  res.json(await bk.listResources(req.ctx!));
}));
router.post('/booking-resources', RES('create'), validate(bk.ResourceInput), tx(async (req, res) => {
  res.status(201).json(await bk.saveResource(req.ctx!, req.body));
}));
router.put('/booking-resources/:id', RES('edit'), validate(IdParam, 'params'), validate(bk.ResourceInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...body } = req.body as z.infer<typeof bk.ResourceInput> & { version: number };
  res.json(await bk.saveResource(req.ctx!, body, String(req.params.id), version));
}));
router.delete('/booking-resources/:id', RES('delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await bk.deleteResource(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Staff hours and time off ──
router.get('/staff', VIEW, tx(async (req, res) => {
  res.json(await bk.listStaff(req.ctx!));
}));
router.put('/staff/:id/hours', RES('edit'), validate(IdParam, 'params'), validate(bk.HoursInput), tx(async (req, res) => {
  res.json(await bk.saveHours(req.ctx!, String(req.params.id), req.body));
}));
router.post('/staff-time-off', RES('edit'), validate(bk.TimeOffInput), tx(async (req, res) => {
  res.status(201).json(await bk.addTimeOff(req.ctx!, req.body));
}));
router.delete('/staff-time-off/:id', RES('edit'), validate(IdParam, 'params'), tx(async (req, res) => {
  await bk.deleteTimeOff(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Online booking page settings ──
router.get('/booking-settings', VIEW, tx(async (req, res) => {
  res.json(await bk.getSettings(req.ctx!));
}));
router.put('/booking-settings', RES('edit'), validate(bk.SettingsInput), tx(async (req, res) => {
  res.json(await bk.saveSettings(req.ctx!, req.body));
}));


export default router;
