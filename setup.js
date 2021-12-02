const child_process = require("child_process");
const { promisify } = require("util");

const execFile = promisify(child_process.execFile);

(async () => {
  await execFile("npm", ["install"], { env: { NODE_ENV: "production" } });
})();
