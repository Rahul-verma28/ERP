// Audit actions ("billing.invoice.issue") in plain words ("Issued an invoice") and the area they
// belong to, for Settings › Audit log. Exact wording for the ones people ask about most; the rest
// is made from the action's parts, so a new action never shows as code.

const EXACT: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.password_reset': 'Reset password',
  'auth.password_expired_change': 'Changed an expired password',
  'auth.access_link_used': 'Signed in with a login link',
  'tenant.created': 'Created the business',
  'tenant.update': 'Changed business details',
  'tenant.profile.update': 'Changed the business profile',
  'tenant.close': 'Closed the business account',
  'tenant.reopen': 'Reopened the business account',
  'tenant.data.export': 'Exported all business data',
  'tenant.sign_ins.export': 'Exported the sign-in history',
  'tenant.security.update': 'Changed security settings',
  'tenant.notifications.update': 'Changed notification settings',
  'tenant.session.sign_out': 'Signed a device out',
  'tenant.session.sign_out_all': 'Signed everyone out',
  'tenant.member.mfa_reset': 'Reset a user\'s two-step verification',
  'tenant.sample_data.add': 'Added sample data',
  'tenant.sample_data.remove': 'Removed sample data',
  'tenant.sequence.start': 'Set where a number series starts',
  'tenant.sequence.next': 'Changed the next number of a series',
  'tenant.handover_accepted': 'Took over the business from AHEAD',
  'tenant.acquisition_changed': 'AHEAD changed who brought the business in',
  'subscription.transition': 'Plan or subscription changed',
  'member.invite': 'Invited a user',
  'member.invite_resend': 'Sent an invitation again',
  'member.invite_revoke': 'Cancelled an invitation',
  'member.joined': 'Joined the business',
  'member.leave': 'Left the business',
  'member.sign_out_all': 'Signed a user out everywhere',
  'member.update': 'Updated a user',
  'member.role_change': 'Changed a user\'s role',
  'role.create': 'Added a role',
  'role.update': 'Changed a role',
  'role.delete': 'Deleted a role',
  'branch.create': 'Added a branch',
  'branch.update': 'Changed a branch',
  'config.terms.update': 'Changed terminology',
  'config.field.create': 'Added a custom field',
  'config.field.update': 'Changed a custom field',
  'settings.changed': 'Changed settings',
  'settings.reset': 'Reset settings',
  'account.password.change': 'Changed their password',
  'account.profile.update': 'Changed their profile',
  'account.mfa.disable': 'Turned off two-step verification',
  'account.mfa.backup_codes': 'Made new backup codes',
  'account.sessions.not_me': 'Reported a sign-in as not them',
  'billing.invoice.issue': 'Issued an invoice',
  'billing.invoice.cancel': 'Cancelled an invoice',
  'billing.invoice.remind': 'Sent a payment reminder',
  'billing.invoice.over_credit_limit': 'Billed over a customer\'s credit limit',
  'billing.payment.record': 'Recorded a payment',
  'billing.payment.reverse': 'Reversed a payment',
  'billing.receipt.record': 'Recorded a receipt',
  'billing.dues.remind': 'Sent dues reminders',
  'billing.einvoice_json.download': 'Downloaded e-invoice JSON',
  'billing.eway_json.download': 'Downloaded e-way bill JSON',
  'billing.gst_refs.save': 'Saved IRN / e-way bill numbers',
  'billing.pos.sale': 'Made a counter sale',
  'billing.pos.return': 'Took a counter return',
  'billing.pos.shift_open': 'Opened a counter shift',
  'billing.pos.shift_close': 'Closed a counter shift',
  'billing.pos.cash_move': 'Moved cash in or out of a counter',
  'billing.pos.counter_create': 'Added a counter',
  'billing.pos.counter_edit': 'Changed a counter',
  'inventory.purchase_bill.post': 'Posted a purchase invoice',
  'inventory.purchase_order.close': 'Closed a purchase order',
  'inventory.purchase_return.approve': 'Approved a purchase return',
  'inventory.purchase_return.complete': 'Completed a purchase return',
  'hr.candidate.hire': 'Hired a candidate',
  'hr.employee.exit': 'Recorded an employee leaving',
  'hr.payroll.process': 'Processed payroll',
  'hr.payroll.pay': 'Marked salaries paid',
  'hr.payroll.unpay': 'Undid a salary payment',
  'hr.leave.apply': 'Applied for leave',
  'crm.lead.bulk_delete': 'Deleted leads in bulk',
};

const VERB: Record<string, string> = {
  create: 'Added', add: 'Added', update: 'Changed', edit: 'Changed', delete: 'Deleted', remove: 'Removed', cancel: 'Cancelled',
  approve: 'Approved', approved: 'Approved', reject: 'Rejected', rejected: 'Rejected', issue: 'Issued', post: 'Posted', export: 'Exported',
  import: 'Imported', record: 'Recorded', reverse: 'Reversed', use: 'Used', set: 'Set', save: 'Saved', close: 'Closed', complete: 'Completed',
  confirm: 'Confirmed', reopen: 'Reopened', draft: 'Saved a draft of', delete_draft: 'Deleted a draft of', pay: 'Paid', process: 'Processed',
  create_link: 'Made a link for', download: 'Downloaded', remind: 'Reminded about',
};

/** "price_list" → "price list", with a few that read better */
const NOUN: Record<string, string> = {
  preferences: 'settings', sign_ins: 'sign-in history', purchase_bill: 'purchase invoice', supplier_payment: 'supplier payment',
  emp_doc: 'employee document', credit_note: 'credit note', debit_note: 'debit note', opening_balance: 'opening balance',
  goods_receipt: 'goods receipt', purchase_order: 'purchase order', purchase_return: 'purchase return', stock_count: 'stock count',
};
const noun = (s: string) => NOUN[s] ?? s.replace(/_/g, ' ');

export function describeAction(action: string): string {
  if (EXACT[action]) return EXACT[action];
  const parts = action.split('.');
  // tenant.preferences.<section> → "Changed <section> settings"
  if (parts[0] === 'tenant' && parts[1] === 'preferences') return `Changed ${noun(parts[2] ?? '')} settings`.replace('  ', ' ');
  const verb = parts[parts.length - 1];
  const thing = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  if (verb === 'won' || verb === 'lost') return `Marked a ${noun(thing)} ${verb}`;
  const v = VERB[verb];
  const n = noun(thing);
  if (v) return `${v} ${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`.replace(/ a (settings|sign-in history|data)$/, ' $1');
  // hr.<kind>.<status> and the like: "Leave: approved"
  return `${n.charAt(0).toUpperCase()}${n.slice(1)}: ${noun(verb)}`;
}

/** The area an action belongs to, for the filter */
export const AUDIT_AREAS: Record<string, { label: string; prefixes: string[] }> = {
  signin: { label: 'Sign-ins & account', prefixes: ['auth.', 'account.', 'tenant.session', 'tenant.sign_ins'] },
  team: { label: 'Users & roles', prefixes: ['member.', 'role.', 'tenant.member'] },
  settings: { label: 'Settings', prefixes: ['tenant.', 'branch.', 'config.', 'settings.', 'portal.settings', 'support.settings', 'hr.settings'] },
  plan: { label: 'Plan & subscription', prefixes: ['subscription.'] },
  sales: { label: 'Sales & billing', prefixes: ['billing.', 'sales.', 'crm.', 'portal.'] },
  purchase: { label: 'Purchase & stock', prefixes: ['inventory.'] },
  items: { label: 'Items', prefixes: ['catalog.'] },
  finance: { label: 'Accounts & finance', prefixes: ['finance.'] },
  hr: { label: 'HR & payroll', prefixes: ['hr.'] },
  work: { label: 'Tasks, bookings & support', prefixes: ['tasks.', 'bookings.', 'support.'] },
};

export function areaOf(action: string): string {
  // The most specific match wins (tenant.session belongs to sign-ins, not settings)
  let best: { key: string; len: number } | null = null;
  for (const [key, a] of Object.entries(AUDIT_AREAS)) for (const p of a.prefixes) if (action.startsWith(p) && (!best || p.length > best.len)) best = { key, len: p.length };
  return best ? AUDIT_AREAS[best.key].label : 'Other';
}
