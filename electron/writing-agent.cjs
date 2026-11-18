// Native provider selection stays outside the shared browser-safe agent.
const core = require('./writing-agent-core.cjs');
const { generateStructured } = require('./providers.cjs');
module.exports = { ...core, runWritingAgent: async (options, generate = generateStructured) => {
  const { createEditorialTools } = await import('./editorial-tools.mjs');
  return core.runWritingAgent(options, generate, createEditorialTools);
} };
