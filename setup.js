const child_process = require("child_process");
const { promisify } = require("util");

const exec = promisify(child_process.exec);

(async () => {
  await exec("npm install --production", {
    cwd: process.env.GITHUB_ACTION_PATH,
  });
})();
