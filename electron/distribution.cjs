const metadata = require('../package.json');
const isStore = process.windowsStore === true || metadata.wraiterDistribution === 'microsoft-store';
module.exports = { isStore };
