const child_process = require("child_process");
const { promisify } = require("util");

const execFile = promisify(child_process.execFile);

(async () => {
  const { stdout } = await execFile("which npm");
  console.log(stdout);

  await execFile("/usr/bin/npm", ["install"], {
    env: { NODE_ENV: "production" },
    cwd: process.env.GITHUB_ACTION_PATH,
  });
})();
