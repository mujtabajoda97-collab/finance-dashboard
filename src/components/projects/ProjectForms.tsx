'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { Sheet } from '../Sheet';
import { supabase } from '@/lib/supabase';
import { convert, parseAmount, round2, formatMoney } from '@/lib/currency';
import { remaining } from '@/lib/debt';
import { flowRest } from '@/lib/projects';
import { isOpenDebt } from '@/lib/derived';
import { px as tx, type AnyKey } from '@/lib/ptext';
import { CURRENCIES, type Currency, type Project, type ProjectCashflow } from '@/lib/types';

type K = AnyKey;

export function ProjectSheet({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { lang, notify } = useApp();
  const { loadProjects, projectsV2 } = useData();
  const T = (k: K) => tx(lang, k);
  const [target, setTarget] = useState(project?.target_date ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [budget, setBudget] = useState(project ? String(project.budget) : '');
  const [currency, setCurrency] = useState<Currency>(project?.currency ?? 'AED');
  const [alloc, setAlloc] = useState(project ? String(project.allocated_amount) : '0');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const b = parseAmount(budget), a = parseAmount(alloc || '0');
  const can = name.trim() !== '' && b > 0 && a >= 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const row = { name: name.trim(), budget: round2(b), currency, allocated_amount: round2(a), notes: notes.trim() || null,
      ...(projectsV2 ? { target_date: target || null } : {}) };
    const { error } = project
      ? await supabase().from('projects').update(row).eq('id', project.id)
      : await supabase().from('projects').insert(row);
    setBusy(false);
    if (error) return notify(error.message, 'error');
    await loadProjects();
    onClose();
  }

  async function remove() {
    if (!project || !window.confirm(T('confirmDelete'))) return;
    setBusy(true);
    const { error } = await supabase().from('projects').delete().eq('id', project.id);
    setBusy(false);
    if (error) return notify(error.message, 'error');
    await loadProjects();
    onClose();
  }

  return (
    <Sheet title={project ? T('editProject') : T('addProject')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="label">{T('projectName')}</span>
          <input autoFocus className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2"><span className="label">{T('budget')}</span>
            <input className="field num font-mono" inputMode="decimal" dir="ltr" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label><span className="label">{T('currency')}</span>
            <select className="field px-2" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="label">{T('allocated')}</span>
          <input className="field num font-mono" inputMode="decimal" dir="ltr" value={alloc} onChange={(e) => setAlloc(e.target.value)} /></label>
        {projectsV2 && (
          <label className="block"><span className="label">{T('targetDate')}</span>
            <input type="date" dir="ltr" className="field num font-mono" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        )}
        <label className="block"><span className="label">{T('notes')}</span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
        </button>
        {project && (
          <button type="button" onClick={remove} disabled={busy} className="btn w-full border border-rose-400/50 py-2 text-rose-700 dark:text-rose-300">
            {T('deleteProject')}
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function FlowSheet({ project, direction, onClose }: { project: Project; direction: 'IN' | 'OUT'; onClose: () => void }) {
  const { lang, notify } = useApp();
  const { loadProjects, debts } = useData();
  const T = (k: K) => tx(lang, k);
  const [title, setTitle] = useState('');
  const [raw, setRaw] = useState('');
  const [currency, setCurrency] = useState<Currency>(project.currency);
  const [due, setDue] = useState('');
  const [debtId, setDebtId] = useState('');
  const [busy, setBusy] = useState(false);
  const wanted = direction === 'IN' ? 'RECEIVABLE' : 'PAYABLE';
  const linkable = debts.filter((d) => isOpenDebt(d) && d.type === wanted);
  const amount = parseAmount(raw);
  const can = title.trim() !== '' && amount > 0 && !busy;

  function pickDebt(id: string) {
    setDebtId(id);
    const d = linkable.find((x) => x.id === id);
    if (!d) return;
    setTitle(d.person_name);
    setRaw(String(remaining(d.total_amount, d.paid_amount)));
    setCurrency(d.currency);
    setDue(d.due_date ?? '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const { error } = await supabase().from('project_cashflows').insert({
      project_id: project.id, direction, title: title.trim(), amount: round2(amount), currency,
      due_date: due || null, debt_id: debtId || null,
    });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    await loadProjects();
    onClose();
  }

  return (
    <Sheet title={`${project.name} · ${direction === 'IN' ? T('addInflow') : T('addOutflow')}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {linkable.length > 0 && (
          <label className="block"><span className="label">{T('linkDebt')}</span>
            <select className="field" value={debtId} onChange={(e) => pickDebt(e.target.value)}>
              <option value="">{T('noLink')}</option>
              {linkable.map((d) => (
                <option key={d.id} value={d.id}>{d.person_name} · {formatMoney(remaining(d.total_amount, d.paid_amount), d.currency, lang)}</option>
              ))}
            </select></label>
        )}
        <label className="block"><span className="label">{T('itemTitle')}</span>
          <input autoFocus className="field" placeholder={direction === 'IN' ? T('sourcePlaceholder') : ''} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2"><span className="label">{T('amount')}</span>
            <input className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
          <label><span className="label">{T('currency')}</span>
            <select className="field px-2" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="label">{T('dueDate')}</span>
          <input type="date" dir="ltr" className="field num font-mono" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('add')}
        </button>
      </form>
    </Sheet>
  );
}

/** Record a partial or full payment on a cash-flow item. Receipts also top up the project's set-aside amount. */
export function PaySheet({ project, flow, onClose }: { project: Project; flow: ProjectCashflow; onClose: () => void }) {
  const { lang, notify } = useApp();
  const { loadProjects, rates } = useData();
  const T = (k: K) => tx(lang, k);
  const rest = flowRest(flow);
  const [raw, setRaw] = useState(String(rest));
  const [busy, setBusy] = useState(false);
  const amount = parseAmount(raw);
  const isIn = flow.direction === 'IN';
  const can = amount > 0 && amount <= rest + 0.004 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    const pay = Math.min(round2(amount), rest);
    let alloc = 0;
    if (isIn) {
      const c = convert(pay, flow.currency, project.currency, rates);
      if (c === null) return notify(T('noRateNote'), 'error');
      alloc = round2(c);
    }
    setBusy(true);
    const { error } = await supabase().rpc('project_receive', { p_flow: flow.id, p_amount: pay, p_alloc: alloc });
    setBusy(false);
    if (error) {
      const missing = /could not find the function|PGRST202|schema cache/i.test(error.message);
      return notify(missing ? T('sqlV2Missing') : error.message, 'error');
    }
    await loadProjects();
    onClose();
  }

  return (
    <Sheet title={`${flow.title} · ${isIn ? T('payIn') : T('payOut')}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="num text-sm text-muted dark:text-night-muted">
          {T('paidWord')} {formatMoney(flow.amount - rest, flow.currency, lang)} {T('progressOf')} {formatMoney(flow.amount, flow.currency, lang)} · {T('restWord')} {formatMoney(rest, flow.currency, lang)}
        </p>
        <label className="block"><span className="label">{isIn ? T('payAmountIn') : T('payAmountOut')} ({flow.currency})</span>
          <input autoFocus className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
        {amount > rest + 0.004 && <p className="text-xs text-rose-600">{T('payTooMuch')}</p>}
        <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">{isIn ? T('payHintIn') : T('payHintOut')}</p>
        <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
        </button>
      </form>
    </Sheet>
  );
}
