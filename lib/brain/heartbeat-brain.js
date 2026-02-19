#!/usr/bin/env node
// Brain Heartbeat — Standalone maintenance script
// Usage: node workspace/lib/brain/heartbeat-brain.js
// Outputs JSON to stdout for the agent to interpret

const path = require('path');

function run() {
  const { getDB } = require('../utils');
  const config = require('../config');
  const { AnomalyDetector } = require('./anomaly-detector');
  const { PatternDetector } = require('./pattern-detector');
  const { GraphUpdater } = require('./graph-updater');

  const db = getDB();
  const updater = new GraphUpdater(db);
  const results = {
    anomalies: [],
    patterns_refreshed: 0,
    edges_decayed: 0,
    observations_swept: 0,
    gst_todos: [],
    alerts: [],
  };

  // 1. Anomaly detection
  try {
    const detector = new AnomalyDetector(db, config);
    const anomalies = detector.detectAll();
    for (const obs of anomalies) {
      const id = updater.addObservation(obs);
      results.anomalies.push({ id, type: obs.type, content: obs.content, confidence: obs.confidence });
    }
  } catch (e) {
    results.anomaly_error = e.message;
  }

  // 2. Pattern refresh
  try {
    const patternDetector = new PatternDetector(db);
    const patternResults = patternDetector.refreshAll();
    results.patterns_refreshed = patternResults.contacts_refreshed;
    results.broken_rhythms = patternResults.broken_rhythms;
  } catch (e) {
    results.pattern_error = e.message;
  }

  // 3. Edge decay
  try {
    results.edges_decayed = db.decayBrainEdges();
  } catch (e) {
    results.decay_error = e.message;
  }

  // 4. Observation sweep
  try {
    results.observations_swept = db.sweepExpiredObservations();
  } catch (e) {
    results.sweep_error = e.message;
  }

  // 5. Festival/deadline checks (GST filing dates)
  try {
    const today = new Date();
    const dayOfMonth = today.getDate();
    const advanceDays = config.get('gst_reminder_advance_days') || 7;
    const urgentDays = config.get('gst_reminder_urgent_days') || 2;

    // Helper: check for existing unresolved GST observation to avoid duplicates
    function hasActiveGstTodo(form) {
      const existing = db.getActiveObservations({ type: 'todo', limit: 20 });
      return existing.some(o => o.properties && o.properties.check === 'gst_deadline' && o.properties.form === form);
    }

    // GSTR-1: 11th of each month
    const gstr1Due = 11;
    const daysToGstr1 = gstr1Due - dayOfMonth;
    if (daysToGstr1 >= 0 && daysToGstr1 <= advanceDays && !hasActiveGstTodo('GSTR-1')) {
      const dayLabel = daysToGstr1 === 0 ? 'TODAY' : `in ${daysToGstr1} day${daysToGstr1 > 1 ? 's' : ''}`;
      const todo = {
        type: 'todo',
        content: `GSTR-1 filing due ${dayLabel} (${gstr1Due}th)`,
        properties: { check: 'gst_deadline', form: 'GSTR-1', due_day: gstr1Due, days_remaining: daysToGstr1 },
        confidence: 1.0,
        source: 'calendar',
      };
      updater.addObservation(todo);
      results.gst_todos.push(todo.content);
      if (daysToGstr1 <= urgentDays) {
        results.alerts.push({ severity: 'urgent', message: todo.content });
      }
    }

    // GSTR-3B: 20th of each month
    const gstr3bDue = 20;
    const daysToGstr3b = gstr3bDue - dayOfMonth;
    if (daysToGstr3b >= 0 && daysToGstr3b <= advanceDays && !hasActiveGstTodo('GSTR-3B')) {
      const dayLabel = daysToGstr3b === 0 ? 'TODAY' : `in ${daysToGstr3b} day${daysToGstr3b > 1 ? 's' : ''}`;
      const todo = {
        type: 'todo',
        content: `GSTR-3B filing due ${dayLabel} (${gstr3bDue}th)`,
        properties: { check: 'gst_deadline', form: 'GSTR-3B', due_day: gstr3bDue, days_remaining: daysToGstr3b },
        confidence: 1.0,
        source: 'calendar',
      };
      updater.addObservation(todo);
      results.gst_todos.push(todo.content);
      if (daysToGstr3b <= urgentDays) {
        results.alerts.push({ severity: 'urgent', message: todo.content });
      }
    }

    // March 31: Financial year end
    const month = today.getMonth(); // 0-indexed
    if (month === 2) { // March
      const daysToFYEnd = 31 - dayOfMonth;
      if (daysToFYEnd >= 0 && daysToFYEnd <= advanceDays) {
        const existing = db.getActiveObservations({ type: 'todo', limit: 20 });
        const hasFyTodo = existing.some(o => o.properties && o.properties.check === 'fy_end');
        if (!hasFyTodo) {
          const dayLabel = daysToFYEnd === 0 ? 'TODAY' : `in ${daysToFYEnd} days`;
          const todo = {
            type: 'todo',
            content: `Financial year ending ${dayLabel} — review accounts, collect receivables`,
            properties: { check: 'fy_end', days_remaining: daysToFYEnd },
            confidence: 1.0,
            source: 'calendar',
          };
          updater.addObservation(todo);
          results.gst_todos.push(todo.content);
        }
      }
    }
  } catch (e) {
    results.deadline_error = e.message;
  }

  // 6. Snapshot update (already done in pattern refresh, but add high-confidence alerts)
  // Promote high-severity anomalies to alerts
  for (const a of results.anomalies) {
    if (a.confidence >= 0.7) {
      results.alerts.push({ severity: 'warning', message: a.content });
    }
  }

  db.close();
  return results;
}

if (require.main === module) {
  try {
    const results = run();
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
} else {
  module.exports = { run };
}
