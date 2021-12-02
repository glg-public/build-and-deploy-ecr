const core = require("@actions/core");
const http = require("http");
const child_process = require("child_process");
const { promisify } = require("util");

function getInputs() {
  const accessKeyId = core.getInput("access_key_id", { required: true });
  const secretAccessKey = core.getInput("secret_access_key", {
    required: true,
  });
  const ecrURI = core.getInput("ecr_uri", { required: true });
  const architecture = core.getInput("architecture");
  const buildArgs = core.getInput("build-args");
  const buildConfig = core.getInput("build_config");
  const deploy = core.getBooleanInput("deploy");
  const dockerfile = core.getInput("dockerfile");
  const envFile = core.getInput("env_file");
  const githubSSHKey = core.getInput("github_ssh_key");
  const healthcheck = core.getInput("healthcheck");
  const platform = core.getInput("platform");
  const port = core.getInput("port");
  const registries = core.getInput("registries");
  return {
    accessKeyId,
    secretAccessKey,
    ecrURI,
    architecture,
    buildArgs,
    buildConfig,
    deploy,
    dockerfile,
    envFile,
    githubSSHKey,
    healthcheck,
    platform,
    port,
    registries,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// No need to pull in axios just  for this
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    http
      .get(url, options, (resp) => {
        // A chunk of data has been received.
        resp.on("data", (chunk) => {
          data += chunk;
        });

        // The whole response has been received. Parse it and resolve the promise
        resp.on("end", () => {
          try {
            const retValue = data;
            if (resp.statusCode >= 400) {
              reject({ data: retValue, statusCode: resp.statusCode });
            } else {
              resolve({ data: retValue, statusCode: resp.statusCode });
            }
          } catch (error) {
            reject({ data, error, statusCode: resp.statusCode });
          }
        });
      })
      .on("error", (error) => {
        reject({ data, error });
      });
  });
}

const execFile = promisify(child_process.execFile);

function execWithLiveOutput(command, args, env) {
  return new Promise((resolve, reject) => {
    const cmd = child_process.spawn(command, args, { env });
    cmd.stdout.on("data", (data) => {
      console.log(data.toString());
    });
    cmd.stderr.on("data", (data) => {
      console.error(data.toString());
    });
    cmd.on("exit", (code) => {
      if (code === 0) {
        return resolve();
      } else {
        return reject(code);
      }
    });
  });
}

const util = {
  httpGet,
  execFile,
  execWithLiveOutput,
  sleep,
};

async function runHealthcheck(imageName, inputs) {
  const args = [
    "run",
    "--detach",
    "--net",
    "host",
    "--publish",
    `${inputs.port}:${inputs.port}`,
    "--env",
    `HEALTHCHECK=${inputs.healthcheck}`,
    "--env",
    `PORT=${inputs.port}`,
    "--name",
    "test-container",
  ];

  if (inputs.envFile) {
    args.push("--env-file", inputs.envFile);
  }

  const { stdout: dockerRunStdout } = await util.execFile("docker", [
    ...args,
    imageName,
  ]);
  console.log(dockerRunStdout);

  let attemptCount = 0;
  const maxAttempts = 5;
  const healthcheckURL = `http://localhost:${inputs.port}${inputs.healthcheck}`;
  while (attemptCount < maxAttempts) {
    attemptCount += 1;
    try {
      await util.httpGet(healthcheckURL);
      break;
    } catch (e) {
      console.log(
        `Tested Healthcheck ${healthcheckURL} : Attempt ${attemptCount} of ${maxAttempts}`
      );
      await util.sleep(5000);
    }
  }
  if (attemptCount >= maxAttempts) {
    core.error(
      `Container did not pass healthcheck at ${healthcheckURL} after ${maxAttempts} attempts`
    );
    core.warning(
      "If your container does not require a healthcheck (most jobs don't), then set healthcheck to a blank string."
    );
    core.startGroup("docker logs");
    const { stdout: dockerLogsStdout } = await util.execFile("docker", [
      "logs",
      "test-container",
    ]);
    console.log(dockerLogsStdout);
    core.endGroup();
    process.exit(1);
  }

  console.log("Healthcheck Passed!");
  const { stdout } = await util.execFile("docker", ["stop", "test-container"]);
  console.log(`${stdout} stopped.`);
}

module.exports = {
  getInputs,
  util,
  runHealthcheck,
};
