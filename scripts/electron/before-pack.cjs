const { checkTarget } = require('../check-packaging-target.cjs');
module.exports = async context => checkTarget(context.appOutDir);
