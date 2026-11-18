import { Router } from 'express';
import { z } from 'zod';
import { DateStr, IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import * as tasks from './service';

// Tasks & Projects (TSK-01, TSK-02): tasks with checklists, subtasks, labels, repeats and comments;
// projects; time logs; approvals. Logic lives in service.ts; lists are one round trip each.

const router = Router();
router.use(tenantAuth);
const VIEW = requirePermission('tasks.task.view');

router.get('/tasks/people', VIEW, tx(async (req, res) => {
  res.json(await tasks.people(req.ctx!));
}));

// ── Tasks ──
router.get('/tasks', VIEW, validate(tasks.TaskList, 'query'), tx(async (req, res) => {
  res.json(await tasks.listTasks(req.ctx!, req.query as unknown as z.infer<typeof tasks.TaskList>));
}));
router.get('/tasks/:id', VIEW, validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await tasks.getTask(req.ctx!, String(req.params.id)));
}));
router.post('/tasks', requirePermission('tasks.task.create'), validate(tasks.TaskInput), tx(async (req, res) => {
  res.status(201).json(await tasks.createTask(req.ctx!, req.body));
}));
router.patch('/tasks/:id', requirePermission('tasks.task.edit'), validate(IdParam, 'params'), validate(tasks.TaskInput.partial().extend({ version: z.number().int().optional(), position: z.number().int().min(0).max(1e9).optional() })), tx(async (req, res) => {
  res.json(await tasks.updateTask(req.ctx!, String(req.params.id), req.body));
}));
router.post('/tasks/:id/checklist/:stepId', requirePermission('tasks.task.edit'), validate(z.object({ id: z.string().uuid(), stepId: z.string().min(1).max(40) }), 'params'), validate(z.object({ done: z.boolean() })), tx(async (req, res) => {
  res.json(await tasks.toggleStep(req.ctx!, String(req.params.id), String(req.params.stepId), req.body.done));
}));
router.post('/tasks/:id/comments', VIEW, validate(IdParam, 'params'), validate(z.object({ body: z.string().trim().min(1, 'Write a comment').max(4000) })), tx(async (req, res) => {
  res.status(201).json(await tasks.comment(req.ctx!, String(req.params.id), req.body.body));
}));
router.post('/tasks/:id/duplicate', requirePermission('tasks.task.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.status(201).json(await tasks.duplicateTask(req.ctx!, String(req.params.id)));
}));
router.delete('/tasks/:id', requirePermission('tasks.task.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await tasks.cancelTask(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Projects ──
router.get('/task-projects', VIEW, validate(z.object({ status: z.string().max(12).optional(), q: z.string().trim().max(100).optional() }), 'query'), tx(async (req, res) => {
  res.json(await tasks.listProjects(req.ctx!, req.query as { status?: string; q?: string }));
}));
router.get('/task-projects/:id', VIEW, validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await tasks.getProject(req.ctx!, String(req.params.id)));
}));
router.post('/task-projects', requirePermission('tasks.task.create'), validate(tasks.ProjectInput), tx(async (req, res) => {
  res.status(201).json(await tasks.createProject(req.ctx!, req.body));
}));
router.put('/task-projects/:id', requirePermission('tasks.task.edit'), validate(IdParam, 'params'), validate(z.object({ version: z.number().int() }).passthrough()), tx(async (req, res) => {
  const { version, ...body } = req.body as { version: number };
  res.json(await tasks.updateProject(req.ctx!, String(req.params.id), tasks.ProjectInput.parse(body), version));
}));
router.delete('/task-projects/:id', requirePermission('tasks.task.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await tasks.deleteProject(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Time logs ──
router.get('/task-times', VIEW, validate(z.object({ from: DateStr.optional(), to: DateStr.optional(), userId: z.string().uuid().optional(), projectId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => {
  res.json(await tasks.listTimes(req.ctx!, req.query as { from?: string; to?: string; userId?: string; projectId?: string }));
}));
router.post('/task-times', requirePermission('tasks.task.view'), validate(tasks.TimeInput), tx(async (req, res) => {
  res.status(201).json(await tasks.logTime(req.ctx!, req.body));
}));
router.delete('/task-times/:id', requirePermission('tasks.task.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  await tasks.deleteTime(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Approvals ──
router.get('/approvals', requirePermission('tasks.approval.view'), validate(z.object({ view: z.string().max(12).optional(), q: z.string().trim().max(100).optional() }), 'query'), tx(async (req, res) => {
  res.json(await tasks.listApprovals(req.ctx!, req.query as { view?: string; q?: string }));
}));
router.post('/approvals', requirePermission('tasks.approval.create'), validate(tasks.ApprovalInput), tx(async (req, res) => {
  res.status(201).json(await tasks.requestApproval(req.ctx!, req.body));
}));
router.post('/approvals/:id/decide', requirePermission('tasks.approval.approve'), validate(IdParam, 'params'), validate(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(1000).optional().nullable(), version: z.number().int() })), tx(async (req, res) => {
  res.json(await tasks.decideApproval(req.ctx!, String(req.params.id), req.body.decision, req.body.note, req.body.version));
}));
router.post('/approvals/:id/withdraw', requirePermission('tasks.approval.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await tasks.withdrawApproval(req.ctx!, String(req.params.id)));
}));

export default router;
