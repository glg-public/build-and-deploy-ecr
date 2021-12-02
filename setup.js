const child_process = require("child_process");

child_process.exec("npm install --production", {
  cwd: process.env.GITHUB_ACTION_PATH,
});
