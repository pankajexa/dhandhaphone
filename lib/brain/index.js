// Brain module barrel export

const { ContextLoader, getBrainContext } = require('./context-loader');
const { GraphUpdater } = require('./graph-updater');
const { DoomLoopDetector } = require('./doom-loop');
const { format: formatTemplate, TEMPLATES } = require('./templates');
const { AnomalyDetector } = require('./anomaly-detector');
const { PatternDetector } = require('./pattern-detector');

module.exports = {
  ContextLoader,
  getBrainContext,
  GraphUpdater,
  DoomLoopDetector,
  formatTemplate,
  TEMPLATES,
  AnomalyDetector,
  PatternDetector,
};
