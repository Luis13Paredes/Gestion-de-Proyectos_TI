/**
 * Generador de reporte completo del proyecto en HTML.
 * Se puede abrir en una ventana nueva o descargar como archivo .html.
 * No modifica ningún dato del proyecto; solo lee y presenta la información.
 */

import { formatCurrency, formatIndex, generateSigmoidCurve, calculateProjectMetrics } from './evmCalculations';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const esc = (value) =>
  value == null ? '' : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dateLabel = (value) => (value ? String(value).slice(0, 10) : '—');

const collectActivities = (project) =>
  (project.wbs_phases ?? []).flatMap((phase) =>
    (phase.activities ?? []).map((a) => ({ ...a, phase: phase.phase_name }))
  );

// ---------- Gráficos como SVG (sin dependencias externas) ----------

const svgCurve = (bac, cutDates, width = 700, height = 320) => {
  const budget = toNumber(bac);
  if (budget <= 0) return '';
  const totalDays = 180; // rango representativo del proyecto
  const curve = generateSigmoidCurve(budget, totalDays);

  // Encontrar el último punto real para acortar la curva proyectada si hay cortes
  let cutDayIndex = -1;
  let lastEV = 0;
  let lastAC = 0;
  if (cutDates && cutDates.length > 0) {
    const latest = cutDates[cutDates.length - 1];
    const startDate = new Date('2026-01-15'); // aproximación; se ajusta si hay fechas reales
    const cutDate_ = latest.cut_date ? new Date(latest.cut_date) : null;
    if (cutDate_) {
      const diffDays = Math.floor((cutDate_ - startDate) / (1000 * 60 * 60 * 24));
      cutDayIndex = Math.max(0, Math.min(totalDays, diffDays));
    }
    lastEV = ((toNumber(latest.actual_percentage) || 0) / 100) * budget;
    lastAC = toNumber(latest.actual_cost);
  }

  const margin = { top: 30, right: 30, bottom: 40, left: 60 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Escalas
  const maxY = Math.max(budget, lastAC * 1.3, 1);
  const scaleX = (x) => margin.left + (x / totalDays) * innerW;
  const scaleY = (y) => margin.top + innerH - (y / maxY) * innerH;

  let svg = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <!-- Ejes -->
    <line x1="${margin.left}" y1="${margin.top + innerH}" x2="${margin.left + innerW}" y2="${margin.top + innerH}" stroke="#94a3b8" stroke-width="1"/>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}" stroke="#94a3b8" stroke-width="1"/>
    <text x="${margin.left + innerW / 2}" y="${height - 8}" text-anchor="middle" font-size="12" fill="#64748b">Días del proyecto</text>
    <text x="14" y="${margin.top + innerH / 2}" text-anchor="middle" font-size="12" fill="#64748b" transform="rotate(-90 14,${margin.top + innerH / 2})">USD</text>

    <!-- Curva PV (planificado) -->
    <polyline fill="none" stroke="#3b82f6" stroke-width="2" points="${curve
      .map((p) => `${scaleX(p.day)},${scaleY(p.pv)}`)
      .join(' ')}" />

    <!-- Línea EV real hasta corte -->
    ${cutDayIndex >= 0 ? `<polyline fill="none" stroke="#10b981" stroke-width="2" points="0,0 ${scaleX(cutDayIndex)},${scaleY(lastEV)}" transform="translate(${margin.left},${margin.top})" />` : ''}

    <!-- Línea AC real hasta corte -->
    ${cutDayIndex >= 0 ? `<polyline fill="none" stroke="#ef4444" stroke-width="2" points="0,0 ${scaleX(cutDayIndex)},${scaleY(lastAC)}" transform="translate(${margin.left},${margin.top})" />` : ''}

    <!-- Leyenda -->
    <rect x="${margin.left}" y="${margin.top - 22}" width="12" height="12" fill="#3b82f6"/>
    <text x="${margin.left + 18}" y="${margin.top - 8}" font-size="12" fill="#1e293b">PV - Valor Planificado</text>
    ${cutDayIndex >= 0 ? `<rect x="${margin.left + 200}" y="${margin.top - 22}" width="12" height="12" fill="#10b981"/><text x="${margin.left + 216}" y="${margin.top - 8}" font-size="12" fill="#1e293b">EV - Valor Ganado (real)</text>` : ''}
    ${cutDayIndex >= 0 ? `<rect x="${margin.left + 420}" y="${margin.top - 22}" width="12" height="12" fill="#ef4444"/><text x="${margin.left + 436}" y="${margin.top - 8}" font-size="12" fill="#1e293b">AC - Costo Real (real)</text>` : ''}
  </svg>`;
  return svg;
};

const svgRiskMatrix = (risks, width = 500, height = 400) => {
  if (!risks || risks.length === 0) return '<p>Sin riesgos registrados.</p>';
  const margin = { top: 40, right: 40, bottom: 60, left: 60 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const cellW = innerW / 5;
  const cellH = innerH / 5;

  const severityColor = (p, i) => {
    const score = p * i;
    if (score <= 2) return '#22c55e';
    if (score <= 4) return '#84cc16';
    if (score <= 9) return '#eab308';
    if (score <= 14) return '#f97316';
    if (score <= 19) return '#ef4444';
    return '#dc2626';
  };

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${width / 2}" y="20" text-anchor="middle" font-size="16" font-weight="bold" fill="#1e293b">Matriz de Riesgos (Probabilidad × Impacto)</text>
  `;

  // Filas (Impacto 5 arriba, 1 abajo) y columnas (Prob 1-5 izquierda a derecha)
  for (let impact = 5; impact >= 1; impact--) {
    for (let prob = 1; prob <= 5; prob++) {
      const x = margin.left + (prob - 1) * cellW;
      const y = margin.top + (5 - impact) * cellH;
      const score = prob * impact;
      const color = severityColor(prob, impact);
      const cellRisks = risks.filter((r) => r.probability_level === prob && r.impact_level === impact);

      svg += `<rect x="${x}" y="${y}" width="${cellW - 1}" height="${cellH - 1}" fill="${color}1a" stroke="${color}" stroke-width="1"/>`;
      if (cellRisks.length > 0) {
        svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}">${cellRisks.length}</text>`;
      }
    }
  }

  // Etiquetas ejes
  for (let i = 1; i <= 5; i++) {
    svg += `<text x="${margin.left + (i - 0.5) * cellW}" y="${margin.top + innerH + 25}" text-anchor="middle" font-size="12" fill="#64748b">${i}</text>`;
    svg += `<text x="${margin.left - 10}" y="${margin.top + (5 - i + 0.5) * cellH + 5}" text-anchor="end" font-size="12" fill="#64748b">${i}</text>`;
  }
  svg += `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#64748b">Probabilidad (1-5)</text>`;
  svg += `<text x="12" y="${height / 2}" text-anchor="middle" font-size="12" fill="#64748b" transform="rotate(-90 12,${height / 2})">Impacto (1-5)</text>`;

  svg += `</svg>`;
  return svg;
};

const svgPareto = (defects, width = 500, height = 300) => {
  if (!defects || defects.length === 0) return '<p>Sin defectos registrados.</p>';

  const totals = new Map();
  for (const d of defects) {
    const key = String(d.category || 'Sin categoría').trim();
    totals.set(key, (totals.get(key) || 0) + toNumber(d.qty));
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const grandTotal = sorted.reduce((s, [, q]) => s + q, 0);

  const margin = { top: 40, right: 40, bottom: 60, left: 80 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const maxQty = Math.max(...sorted.map(([, q]) => q));
  const scaleX = (i) => margin.left + (i / sorted.length) * innerW;
  const scaleY = (q) => margin.top + innerH - (q / maxQty) * innerH;

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif;">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${width / 2}" y="20" text-anchor="middle" font-size="16" font-weight="bold" fill="#1e293b">Pareto de Defectos por Categoría</text>
  `;

  let cumulative = 0;
  sorted.forEach(([category, qty], i) => {
    cumulative += qty;
    const x = scaleX(i);
    const y = scaleY(qty);
    const barH = innerH - (qty / maxQty) * innerH;
    svg += `<rect x="${x + 10}" y="${y}" width="${innerW / sorted.length - 20}" height="${barH}" fill="#3b82f6"/>`;
    svg += `<text x="${x + innerW / sorted.length / 2}" y="${margin.top + innerH + 15}" text-anchor="middle" font-size="10" fill="#64748b">${esc(category)}</text>`;
    svg += `<text x="${x + innerW / sorted.length / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1e293b">${qty}</text>`;
  });

  svg += `</svg>`;
  return svg;
};

// ---------- Construcción del HTML ----------

export const generateProjectReportHtml = (project) => {
  const bac = toNumber(project.bac);
  const cutDates = Array.isArray(project.cut_dates) ? project.cut_dates : [];
  const latest = cutDates.length > 0 ? cutDates[cutDates.length - 1] : null;
  const metrics = latest ? calculateProjectMetrics(bac, latest) : null;

  const activities = collectActivities(project);
  const teamMembers = Array.isArray(project.team_members) ? project.team_members : [];
  const risks = Array.isArray(project.risks) ? project.risks : [];
  const quality = project.quality ?? {};
  const audits = Array.isArray(quality.audits) ? quality.audits : [];
  const defects = Array.isArray(quality.defects) ? quality.defects : [];
  const changes = Array.isArray(project.change_requests) ? project.change_requests : [];
  const costItems = project.cost_items ?? {};
  const resources = Array.isArray(project.resources) ? project.resources : [];
  const raci = project.raci ?? {};
  const blueprint = project.blueprint ?? {};
  const problem = project.problem ?? {};
  const justification = project.justification ?? {};

  const curveSvg = svgCurve(bac, cutDates);
  const riskMatrixSvg = svgRiskMatrix(risks);
  const paretoSvg = svgPareto(defects);

  const statusLabel = (metrics?.cpi ?? 0) >= 1 && (metrics?.spi ?? 0) >= 1 ? 'Saludable' : (metrics?.cpi ?? 0) < 0.85 || (metrics?.spi ?? 0) < 0.85 ? 'Crítico' : 'Atención';

  const statusColor = statusLabel === 'Saludable' ? '#22c55e' : statusLabel === 'Crítico' ? '#dc2626' : '#f59e0b';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte Completo — ${esc(project.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; line-height: 1.5; background: #f8fafc; }
  .page { max-width: 1000px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .page h1 { font-size: 26px; margin: 0 0 4px; color: #0f172a; }
  .page .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .page h2 { font-size: 18px; border-bottom: 2px solid #0d6efd; padding-bottom: 6px; margin: 30px 0 16px; color: #0d6efd; }
  .page h3 { font-size: 15px; margin: 20px 0 8px; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
  th { background: #f1f5f9; font-weight: 600; color: #475569; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; }
  .badge-ok { background: #22c55e; }
  .badge-warn { background: #f59e0b; }
  .badge-danger { background: #dc2626; }
  .meta-row { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .meta-item { flex: 1; min-width: 150px; }
  .meta-item .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 4px; }
  .meta-item .value { font-size: 15px; font-weight: 600; color: #1e293b; }
  .chart-wrap { margin: 16px 0; page-break-inside: avoid; }
  .section-break { page-break-before: always; }
  .small { font-size: 12px; color: #64748b; }
  .evm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
  .evm-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .evm-card .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
  .evm-card .value { font-size: 20px; font-weight: 700; margin-top: 4px; font-family: 'Courier New', monospace; }
  .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center; }
  .print-btn { background: #0d6efd; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .print-btn:hover { background: #0b5ed7; }
</style>
</head>
<body>
<div class="page">
  <h1>Reporte de Gestión de Proyecto</h1>
  <div class="subtitle">${esc(project.name)} · ${dateLabel(project.start_date)} al ${dateLabel(project.end_date)} · Generado el ${new Date().toLocaleDateString('es-ES')}</div>

  <!-- 1. RESUMEN EJECUTIVO -->
  <h2>1. Resumen Ejecutivo</h2>
  <div class="meta-row">
    <div class="meta-item"><div class="label">Estado del proyecto</div><div class="value"><span class="badge ${statusLabel === 'Saludable' ? 'badge-ok' : statusLabel === 'Crítico' ? 'badge-danger' : 'badge-warn'}">${statusLabel}</span></div></div>
    <div class="meta-item"><div class="label">Presupuesto (BAC)</div><div class="value">${formatCurrency(bac)}</div></div>
    <div class="meta-item"><div class="label">CPI</div><div class="value">${metrics ? formatIndex(metrics.cpi) : '—'}</div></div>
    <div class="meta-item"><div class="label">SPI</div><div class="value">${metrics ? formatIndex(metrics.spi) : '—'}</div></div>
    <div class="meta-item"><div class="label">Fecha de corte</div><div class="value">${latest ? dateLabel(latest.cut_date) : 'Sin registrar'}</div></div>
  </div>
  ${metrics ? `
  <div class="evm-grid">
    <div class="evm-card"><div class="label">EV (Valor Ganado)</div><div class="value">${formatCurrency(metrics.ev)}</div></div>
    <div class="evm-card"><div class="label">AC (Costo Real)</div><div class="value">${formatCurrency(metrics.ac)}</div></div>
    <div class="evm-card"><div class="label">PV (Valor Planificado)</div><div class="value">${formatCurrency(metrics.pv)}</div></div>
    <div class="evm-card"><div class="label">CV (Var. Costo)</div><div class="value">${formatCurrency(metrics.cv)}</div></div>
    <div class="evm-card"><div class="label">SV (Var. Cronograma)</div><div class="value">${formatCurrency(metrics.sv)}</div></div>
    <div class="evm-card"><div class="label">EAC Realista</div><div class="value">${formatCurrency(metrics.eac_realistic)}</div></div>
    <div class="evm-card"><div class="label">VAC</div><div class="value">${formatCurrency(metrics.vac)}</div></div>
    <div class="evm-card"><div class="label">ETC</div><div class="value">${formatCurrency(metrics.etc)}</div></div>
  </div>
  ` : `<p class="small">No hay fecha de corte registrada. Agrega una en Seguimiento para ver EVM.</p>`}

  <!-- 2. ACTA Y ALCANCE -->
  <h2>2. Acta y Alcance</h2>
  <h3>2.1 Diagnóstico (Árbol de Problemas)</h3>
  <div class="card">
    <p><strong>Problema central:</strong> ${esc(problem.central || '—')}</p>
    <p><strong>Causas:</strong> ${Array.isArray(problem.causas) ? problem.causas.map(c => esc(c)).join(', ') : '—'}</p>
    <p><strong>Efectos:</strong> ${Array.isArray(problem.efectos) ? problem.efectos.map(e => esc(e)).join(', ') : '—'}</p>
  </div>
  <h3>2.2 Técnica de las 5 Preguntas Clave (PMP)</h3>
  <div class="grid-2">
    <div class="card"><div class="label">¿Qué está ocurriendo?</div><div>${esc(problem.pmp?.que || '—')}</div></div>
    <div class="card"><div class="label">¿Por qué es un problema?</div><div>${esc(problem.pmp?.porque || '—')}</div></div>
    <div class="card"><div class="label">¿A quiénes afecta?</div><div>${esc(problem.pmp?.quienes || '—')}</div></div>
    <div class="card"><div class="label">¿Cuál es la consecuencia?</div><div>${esc(problem.pmp?.consecuencia || '—')}</div></div>
    <div class="card"><div class="label">¿Qué tan urgente es?</div><div>${esc(problem.pmp?.urgencia || '—')}</div></div>
  </div>
  <h3>2.3 Justificación</h3>
  <div class="grid-2">
    <div class="card"><div class="label">Pertinencia</div><div>${esc(justification.pertinencia || '—')}</div></div>
    <div class="card"><div class="label">Urgencia</div><div>${esc(justification.urgencia || '—')}</div></div>
    <div class="card"><div class="label">Viabilidad</div><div>${esc(justification.viabilidad || '—')}</div></div>
    <div class="card"><div class="label">Impacto</div><div>${esc(justification.impacto || '—')}</div></div>
  </div>
  <h3>2.4 Blueprint</h3>
  <div class="card">
    <p><strong>Propósito:</strong> ${esc(blueprint.proposito || '—')}</p>
    <p><strong>Objetivos:</strong> ${esc(blueprint.objetivos || '—')}</p>
    <p><strong>Alcance incluido:</strong> ${esc(blueprint.incluye || '—')}</p>
    <p><strong>Exclusiones:</strong> ${esc(blueprint.excluye || '—')}</p>
    <p><strong>Entregables:</strong> ${esc(blueprint.entregables || '—')}</p>
    <p><strong>Stack / arquitectura:</strong> ${esc(blueprint.stack || '—')}</p>
    <p><strong>Supuestos:</strong> ${esc(blueprint.supuestos || '—')}</p>
    <p><strong>Restricciones:</strong> ${esc(blueprint.restricciones || '—')}</p>
    <p><strong>Hitos macro:</strong> ${esc(blueprint.hitos || '—')}</p>
    <p><strong>Criterios de éxito:</strong> ${esc(blueprint.criterios || '—')}</p>
  </div>

  <!-- 3. EDT Y CRONOGRAMA -->
  <h2>3. Estructura de Desglose del Trabajo (EDT) y Cronograma</h2>
  ${project.wbs_phases && project.wbs_phases.length > 0 ? `
  <table>
    <thead><tr><th>Fase</th><th>Tarea</th><th>Entregable</th><th>Duración (días)</th><th>Costo</th><th>Responsable</th><th>Predecesoras</th><th>% Avance</th></tr></thead>
    <tbody>
    ${project.wbs_phases.map((phase, pi) =>
      (phase.activities ?? []).map((a, ai) => `
        <tr>
          <td>${pi === 0 || ai === 0 ? esc(phase.phase_name) : ''}</td>
          <td><strong>${esc(a.activity_name)}</strong></td>
          <td>${esc(a.deliverable || '—')}</td>
          <td>${a.duration_days}</td>
          <td>${formatCurrency(a.cost)}</td>
          <td>${esc(a.responsable || '—')}</td>
          <td>${Array.isArray(a.predecessors) && a.predecessors.length > 0 ? a.predecessors.join(', ') : 'Inicio'}</td>
          <td>${a.progress_percentage}%</td>
        </tr>
      `).join('')
    ).join('')}
    </tbody>
  </table>
  ` : '<p class="small">Sin tareas registradas en el WBS.</p>'}

  <!-- 4. EQUIPO Y RECURSOS -->
  <h2>4. Equipo y Recursos</h2>
  <h3>4.1 Equipo del Proyecto</h3>
  <table>
    <thead><tr><th>Nombre</th><th>Rol</th></tr></thead>
    <tbody>
    ${teamMembers.map(m => `<tr><td>${esc(m.member_name)}</td><td>${esc(m.member_role)}</td></tr>`).join('')}
    </tbody>
  </table>
  <h3>4.2 Matriz RACI</h3>
  <table>
    <thead><tr><th>Tarea</th>${teamMembers.map(m => `<th>${esc(m.member_name)}</th>`).join('')}</tr></thead>
    <tbody>
    ${activities.map(a => `
      <tr>
        <td><strong>${esc(a.id)}</strong> · ${esc(a.activity_name)}</td>
        ${teamMembers.map(m => {
          const val = raci[a.id]?.[m.id] || '—';
          return `<td style="text-align:center">${esc(val)}</td>`;
        }).join('')}
      </tr>
    `).join('')}
    </tbody>
  </table>
  <h3>4.3 Costeo de Recursos (Mano de obra)</h3>
  <table>
    <thead><tr><th>Rol</th><th>Nombre</th><th>Tipo</th><th>Salario / Costo hora</th><th>Días asignados</th><th>Dedicación %</th><th>Total</th></tr></thead>
    <tbody>
    ${resources.map(r => {
      const hoursMonth = toNumber(project.resource_settings?.hours_month ?? 160);
      const loadFactor = toNumber(project.resource_settings?.load_factor ?? 1.3635);
      const extSurcharge = toNumber(project.resource_settings?.external_surcharge ?? 0.15);
      const hoursDay = toNumber(project.resource_settings?.hours_day ?? 8);
      const isExternal = r.type === 'externo';
      const hourCost = isExternal ? toNumber(r.external_hour_cost) : toNumber(r.monthly_salary) / Math.max(1, hoursMonth);
      const loadedHour = isExternal ? hourCost * (1 + extSurcharge) : hourCost * loadFactor;
      const dayValue = loadedHour * hoursDay;
      const dedication = toNumber(r.dedication_pct ?? 100) / 100;
      const effectiveDays = toNumber(r.assigned_days) * dedication;
      const total = dayValue * effectiveDays;
      return `<tr>
        <td>${esc(r.role)}</td>
        <td>${esc(r.name || '—')}</td>
        <td>${esc(r.type === 'interno' ? 'Interno' : 'Externo')}</td>
        <td>${formatCurrency(isExternal ? r.external_hour_cost : r.monthly_salary)}</td>
        <td>${toNumber(r.assigned_days)}</td>
        <td>${toNumber(r.dedication_pct ?? 100)}%</td>
        <td>${formatCurrency(total)}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
  <div class="grid-2">
    <div class="card"><div class="label">Tecnología / Infraestructura</div>
      <ul>${Array.isArray(costItems.technology) ? costItems.technology.map(i => `<li>${esc(i.concept)}: ${formatCurrency(toNumber(i.qty) * toNumber(i.unit_cost))}</li>`).join('') : '<li>—</li>'}</ul>
    </div>
    <div class="card"><div class="label">Costos fijos e indirectos</div>
      <ul>${[...(Array.isArray(costItems.fixed) ? costItems.fixed : []), ...(Array.isArray(costItems.indirect) ? costItems.indirect : [])].map(i => `<li>${esc(i.concept)}: ${formatCurrency(toNumber(i.qty) * toNumber(i.unit_cost))}</li>`).join('') || '<li>—</li>'}</ul>
    </div>
  </div>
  <div class="card">
    <p><strong>Reserva de contingencia:</strong> ${toNumber(project.contingency_percentage ?? 15)}%</p>
    <p><strong>Reserva de gestión:</strong> ${toNumber(project.management_reserve_percentage ?? 5)}%</p>
  </div>

  <!-- 5. VALOR GANADO (EVM) -->
  <h2>5. Valor Ganado (EVM)</h2>
  <div class="chart-wrap">
    <h3>Curva S — PV, EV, AC</h3>
    ${curveSvg}
  </div>
  ${metrics ? `
  <div class="evm-grid">
    <div class="evm-card"><div class="label">BAC</div><div class="value">${formatCurrency(metrics.bac)}</div></div>
    <div class="evm-card"><div class="label">PV</div><div class="value">${formatCurrency(metrics.pv)}</div></div>
    <div class="evm-card"><div class="label">EV</div><div class="value">${formatCurrency(metrics.ev)}</div></div>
    <div class="evm-card"><div class="label">AC</div><div class="value">${formatCurrency(metrics.ac)}</div></div>
    <div class="evm-card"><div class="label">CPI</div><div class="value">${formatIndex(metrics.cpi)}</div></div>
    <div class="evm-card"><div class="label">SPI</div><div class="value">${formatIndex(metrics.spi)}</div></div>
    <div class="evm-card"><div class="label">EAC Optimista</div><div class="value">${formatCurrency(metrics.eac_optimistic)}</div></div>
    <div class="evm-card"><div class="label">EAC Pesimista</div><div class="value">${formatCurrency(metrics.eac_pessimistic)}</div></div>
    <div class="evm-card"><div class="label">TCPI (BAC)</div><div class="value">${formatIndex(metrics.tcpi_bac)}</div></div>
  </div>
  ` : ''}

  <!-- 6. CALIDAD -->
  <h2>6. Gestión de Calidad</h2>
  <div class="grid-2">
    <div class="card">
      <h3>Auditorías QA/QC</h3>
      <table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Alcance</th><th>Fecha</th><th>Resultado</th><th>Horas</th></tr></thead>
        <tbody>
        ${audits.map(a => `<tr><td>${esc(a.code)}</td><td>${esc(a.audit_type)}</td><td>${esc(a.scope)}</td><td>${dateLabel(a.date)}</td><td><strong>${esc(a.result)}</strong></td><td>${a.hours}h</td></tr>`).join('') || '<tr><td colspan="6" class="small">Sin auditorías registradas.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Costo de Calidad (CoQ)</h3>
      <table>
        <tr><td><strong>Prevención</strong></td><td>${formatCurrency(toNumber(quality.coq?.prevention))}</td></tr>
        <tr><td><strong>Evaluación</strong></td><td>${formatCurrency(toNumber(quality.coq?.appraisal))}</td></tr>
        <tr><td><strong>Fallas internas</strong></td><td>${formatCurrency(toNumber(quality.coq?.internal_failure))}</td></tr>
        <tr><td><strong>Fallas externas</strong></td><td>${formatCurrency(toNumber(quality.coq?.external_failure))}</td></tr>
        <tr><td><strong>Total CoQ</strong></td><td>${formatCurrency(toNumber(quality.coq?.prevention) + toNumber(quality.coq?.appraisal) + toNumber(quality.coq?.internal_failure) + toNumber(quality.coq?.external_failure))}</td></tr>
      </table>
    </div>
  </div>
  <div class="chart-wrap">
    <h3>Pareto de Defectos</h3>
    ${paretoSvg}
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Categoría</th><th>Fecha</th><th>Cantidad</th><th>Descripción</th></tr></thead>
      <tbody>
      ${defects.map(d => `<tr><td>${esc(d.category)}</td><td>${dateLabel(d.date)}</td><td>${d.qty}</td><td>${esc(d.description)}</td></tr>`).join('') || '<tr><td colspan="4" class="small">Sin defectos registrados.</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- 7. RIESGOS -->
  <h2>7. Gestión de Riesgos</h2>
  <div class="chart-wrap">
    ${riskMatrixSvg}
  </div>
  <table>
    <thead><tr><th>Descripción</th><th>RBS</th><th>Tipo</th><th>Prob (1-5)</th><th>Impacto (1-5)</th><th>Impacto $</th><th>EMV</th><th>Respuesta</th><th>Dueño</th></tr></thead>
    <tbody>
    ${risks.map(r => {
      const prob = toNumber(r.probability_level);
      const impact = toNumber(r.impact_level);
      const probValue = {1:0.1,2:0.3,3:0.5,4:0.7,5:0.9}[prob] ?? 0.5;
      const emvValue = probValue * toNumber(r.monetary_impact) * (r.type === 'Oportunidad' ? -1 : 1);
      return `<tr>
        <td>${esc(r.description)}</td>
        <td>${esc(r.rbs_category)}</td>
        <td>${esc(r.type)}</td>
        <td>${prob}</td>
        <td>${impact}</td>
        <td>${formatCurrency(r.monetary_impact)}</td>
        <td>${formatCurrency(emvValue)}</td>
        <td>${esc(r.response)}</td>
        <td>${esc(r.owner || '—')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="small">Sin riesgos registrados.</td></tr>'}
    </tbody>
  </table>
  <div class="card">
    <h3>Árbol de Decisión</h3>
    ${Array.isArray(project.decision_options) && project.decision_options.length > 0 ? `
    <table>
      <thead><tr><th>Opción</th><th>Inversión base</th><th>EMV ramas</th><th>Total</th></tr></thead>
      <tbody>
      ${project.decision_options.map(o => {
        const branchesEmv = Array.isArray(o.branches) ? o.branches.reduce((s, b) => s + (toNumber(b.probability_pct) / 100) * toNumber(b.impact), 0) : 0;
        const total = toNumber(o.base_investment) + branchesEmv;
        return `<tr><td>${esc(o.name)}</td><td>${formatCurrency(o.base_investment)}</td><td>${formatCurrency(branchesEmv)}</td><td><strong>${formatCurrency(total)}</strong></td></tr>`;
      }).join('')}
      </tbody>
    </table>
    ` : '<p class="small">Sin opciones de decisión registradas.</p>'}
  </div>

  <!-- 8. CONTROL DE CAMBIOS -->
  <h2>8. Control de Cambios</h2>
  <table>
    <thead><tr><th>Código</th><th>Fecha</th><th>Cambio</th><th>Entregable</th><th>Horas</th><th>Tarifa</th><th>Costo</th><th>Estado</th><th>Aprobador</th></tr></thead>
    <tbody>
    ${changes.map(c => `<tr>
      <td>${esc(c.code)}</td>
      <td>${dateLabel(c.date)}</td>
      <td>${esc(c.change)}</td>
      <td>${esc(c.deliverable || '—')}</td>
      <td>${c.hours}</td>
      <td>${formatCurrency(c.rate)}</td>
      <td>${formatCurrency(toNumber(c.hours) * toNumber(c.rate))}</td>
      <td><span class="badge ${c.status === 'Aprobado' ? 'badge-ok' : c.status === 'Rechazado' ? 'badge-danger' : 'badge-warn'}">${esc(c.status)}</span></td>
      <td>${esc(c.approver || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="small">Sin solicitudes de cambio registradas.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    Reporte generado automáticamente por el Gestor de Proyectos TI — Sistema EVM. Todos los valores provienen de los datos registrados en la aplicación.
  </div>
</div>
<script>
  window.onload = () => {
    // Auto-imprimir al abrir si se desea; por ahora solo se muestra
  };
</script>
</body>
</html>`;

  return html;
};

export const downloadReportHtml = (project) => {
  const html = generateProjectReportHtml(project);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reporte_${(project.name || 'proyecto').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const openReportWindow = (project) => {
  const html = generateProjectReportHtml(project);
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) {
    // Si el navegador bloquea popups, descargar en su lugar
    downloadReportHtml(project);
    return;
  }
  win.document.write(html);
  win.document.close();
};
