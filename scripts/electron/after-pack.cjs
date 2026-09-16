const { assertPackagedApp } = require('./assert-packaged-app.cjs');

module.exports = async context => {
  assertPackagedApp(context.appOutDir);
};
